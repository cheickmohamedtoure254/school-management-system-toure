import { Schema, model } from "mongoose";
import { IFeeDefaulter, Month } from "./fee.interface";

const feeDefaulterSchema = new Schema<IFeeDefaulter>(
  {
    student: {
      type: Schema.Types.ObjectId,
      ref: "Student",
      required: [true, "Student is required"],
      index: true,
    },
    studentFeeRecord: {
      type: Schema.Types.ObjectId,
      ref: "StudentFeeRecord",
      required: [true, "Student fee record is required"],
      index: true,
    },
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School is required"],
      index: true,
    },
    grade: {
      type: String,
      required: [true, "Grade is required"],
      trim: true,
      index: true,
    },
    totalDueAmount: {
      type: Number,
      required: [true, "Total due amount is required"],
      min: [0, "Total due amount must be non-negative"],
    },
    overdueMonths: {
      type: [Number],
      enum: Object.values(Month).filter((v) => typeof v === "number"),
      validate: {
        validator: function (v: any[]) {
          return v && v.length > 0;
        },
        message: "At least one overdue month is required",
      },
    },
    daysSinceFirstDue: {
      type: Number,
      required: true,
      min: [0, "Days since first due must be non-negative"],
    },
    lastReminderDate: {
      type: Date,
    },
    notificationCount: {
      type: Number,
      default: 0,
      min: [0, "Notification count must be non-negative"],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound index for uniqueness
feeDefaulterSchema.index({ student: 1, studentFeeRecord: 1 }, { unique: true });

// Index for querying defaulters
feeDefaulterSchema.index({ school: 1, daysSinceFirstDue: -1 });
feeDefaulterSchema.index({ school: 1, totalDueAmount: -1 });
feeDefaulterSchema.index({ grade: 1, daysSinceFirstDue: -1 });

// Static method to sync defaulters for a school
feeDefaulterSchema.statics.syncDefaultersForSchool = async function (
  schoolId: string,
  gracePeriodDays: number = 7
) {
  const StudentFeeRecord = model("StudentFeeRecord");
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - gracePeriodDays * 24 * 60 * 60 * 1000);

  // Find all students with overdue payments
  const overdueRecords = await StudentFeeRecord.find({
    school: schoolId,
    "monthlyPayments.status": { $in: ["pending", "partial"] },
    "monthlyPayments.dueDate": { $lt: cutoffDate },
    "monthlyPayments.waived": false,
  }).populate("student");

  const defaultersToUpsert: any[] = [];

  for (const record of overdueRecords) {
    const overdueMonths: Month[] = [];
    let totalDueAmount = 0;
    let firstDueDate: Date | null = null;

    record.monthlyPayments.forEach((payment: any) => {
      if (
        (payment.status === "pending" || payment.status === "partial") &&
        payment.dueDate < cutoffDate &&
        !payment.waived
      ) {
        overdueMonths.push(payment.month);
        totalDueAmount += payment.dueAmount - payment.paidAmount + payment.lateFee;

        if (!firstDueDate || payment.dueDate < firstDueDate) {
          firstDueDate = payment.dueDate as Date;
        }
      }
    });

    if (overdueMonths.length > 0 && firstDueDate !== null) {
      const daysSinceFirstDue = Math.floor(
        (now.getTime() - (firstDueDate as Date).getTime()) / (1000 * 60 * 60 * 24)
      );

      defaultersToUpsert.push({
        student: record.student._id,
        studentFeeRecord: record._id,
        school: schoolId,
        grade: record.grade,
        totalDueAmount,
        overdueMonths,
        daysSinceFirstDue,
      });
    }
  }

  // Upsert defaulters
  const operations = defaultersToUpsert.map((defaulter) => ({
    updateOne: {
      filter: {
        student: defaulter.student,
        studentFeeRecord: defaulter.studentFeeRecord,
      },
      update: {
        $set: defaulter,
        $setOnInsert: { notificationCount: 0 },
      },
      upsert: true,
    },
  }));

  if (operations.length > 0) {
    await this.bulkWrite(operations);
  }

  // Remove defaulters who have cleared their dues
  const activeDefaulterStudents = defaultersToUpsert.map((d) => d.student);
  await this.deleteMany({
    school: schoolId,
    student: { $nin: activeDefaulterStudents },
  });

  return {
    synced: operations.length,
    removed: await this.countDocuments({
      school: schoolId,
      student: { $nin: activeDefaulterStudents },
    }),
  };
};

// Static method to get critical defaulters (high amount or long overdue)
feeDefaulterSchema.statics.getCriticalDefaulters = async function (
  schoolId: string,
  options?: {
    minAmount?: number;
    minDays?: number;
    limit?: number;
  }
) {
  const query: any = { school: schoolId };

  if (options?.minAmount) {
    query.totalDueAmount = { $gte: options.minAmount };
  }

  if (options?.minDays) {
    query.daysSinceFirstDue = { $gte: options.minDays };
  }

  return this.find(query)
    .populate("student", "studentId firstName lastName parentContact")
    .sort({ daysSinceFirstDue: -1, totalDueAmount: -1 })
    .limit(options?.limit || 50);
};

// Static method to get defaulters by grade
feeDefaulterSchema.statics.getDefaultersByGrade = async function (
  schoolId: string,
  grade?: string
) {
  const matchStage: any = { school: schoolId };
  if (grade) {
    matchStage.grade = grade;
  }

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: "$grade",
        count: { $sum: 1 },
        totalDueAmount: { $sum: "$totalDueAmount" },
        avgDaysSinceFirstDue: { $avg: "$daysSinceFirstDue" },
      },
    },
    {
      $sort: { totalDueAmount: -1 },
    },
  ]);
};

// Method to record reminder sent
feeDefaulterSchema.methods.recordReminder = async function () {
  this.lastReminderDate = new Date();
  this.notificationCount += 1;
  return this.save();
};

// Method to check if reminder is due
feeDefaulterSchema.methods.isReminderDue = function (
  reminderIntervalDays: number = 7
): boolean {
  if (!this.lastReminderDate) {
    return true;
  }

  const daysSinceLastReminder = Math.floor(
    (Date.now() - this.lastReminderDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  return daysSinceLastReminder >= reminderIntervalDays;
};

// Static method to get defaulters needing reminders
feeDefaulterSchema.statics.getDefaultersNeedingReminders = async function (
  schoolId: string,
  reminderIntervalDays: number = 7
) {
  const cutoffDate = new Date(
    Date.now() - reminderIntervalDays * 24 * 60 * 60 * 1000
  );

  return this.find({
    school: schoolId,
    $or: [
      { lastReminderDate: { $exists: false } },
      { lastReminderDate: null },
      { lastReminderDate: { $lt: cutoffDate } },
    ],
  })
    .populate("student", "studentId firstName lastName parentContact parentEmail")
    .sort({ daysSinceFirstDue: -1 });
};

// Virtual for severity level
feeDefaulterSchema.virtual("severityLevel").get(function () {
  if (this.daysSinceFirstDue > 60 || this.totalDueAmount > 50000) {
    return "critical";
  } else if (this.daysSinceFirstDue > 30 || this.totalDueAmount > 20000) {
    return "high";
  } else if (this.daysSinceFirstDue > 14 || this.totalDueAmount > 10000) {
    return "medium";
  }
  return "low";
});

import { Model } from "mongoose";
import { IFeeDefaulterModel } from "./fee.interface";

const FeeDefaulter = model<IFeeDefaulter, Model<IFeeDefaulter> & IFeeDefaulterModel>(
  "FeeDefaulter",
  feeDefaulterSchema
);

export default FeeDefaulter;
