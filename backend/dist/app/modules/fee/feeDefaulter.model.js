"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = require("mongoose");
const fee_interface_1 = require("./fee.interface");
const feeDefaulterSchema = new mongoose_1.Schema({
    student: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Student",
        required: [true, "Student is required"],
        index: true,
    },
    studentFeeRecord: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "StudentFeeRecord",
        required: [true, "Student fee record is required"],
        index: true,
    },
    school: {
        type: mongoose_1.Schema.Types.ObjectId,
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
        enum: Object.values(fee_interface_1.Month).filter((v) => typeof v === "number"),
        validate: {
            validator: function (v) {
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
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});
feeDefaulterSchema.index({ student: 1, studentFeeRecord: 1 }, { unique: true });
feeDefaulterSchema.index({ school: 1, daysSinceFirstDue: -1 });
feeDefaulterSchema.index({ school: 1, totalDueAmount: -1 });
feeDefaulterSchema.index({ grade: 1, daysSinceFirstDue: -1 });
feeDefaulterSchema.statics.syncDefaultersForSchool = async function (schoolId, gracePeriodDays = 7) {
    const StudentFeeRecord = (0, mongoose_1.model)("StudentFeeRecord");
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - gracePeriodDays * 24 * 60 * 60 * 1000);
    const overdueRecords = await StudentFeeRecord.find({
        school: schoolId,
        "monthlyPayments.status": { $in: ["pending", "partial"] },
        "monthlyPayments.dueDate": { $lt: cutoffDate },
        "monthlyPayments.waived": false,
    }).populate("student");
    const defaultersToUpsert = [];
    for (const record of overdueRecords) {
        const overdueMonths = [];
        let totalDueAmount = 0;
        let firstDueDate = null;
        record.monthlyPayments.forEach((payment) => {
            if ((payment.status === "pending" || payment.status === "partial") &&
                payment.dueDate < cutoffDate &&
                !payment.waived) {
                overdueMonths.push(payment.month);
                totalDueAmount +=
                    payment.dueAmount - payment.paidAmount + payment.lateFee;
                if (!firstDueDate || payment.dueDate < firstDueDate) {
                    firstDueDate = payment.dueDate;
                }
            }
        });
        if (overdueMonths.length > 0 && firstDueDate !== null) {
            const daysSinceFirstDue = Math.floor((now.getTime() - firstDueDate.getTime()) /
                (1000 * 60 * 60 * 24));
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
feeDefaulterSchema.statics.getCriticalDefaulters = async function (schoolId, options) {
    const query = { school: schoolId };
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
feeDefaulterSchema.statics.getDefaultersByGrade = async function (schoolId, grade) {
    const matchStage = { school: schoolId };
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
feeDefaulterSchema.methods.recordReminder = async function () {
    this.lastReminderDate = new Date();
    this.notificationCount += 1;
    return this.save();
};
feeDefaulterSchema.methods.isReminderDue = function (reminderIntervalDays = 7) {
    if (!this.lastReminderDate) {
        return true;
    }
    const daysSinceLastReminder = Math.floor((Date.now() - this.lastReminderDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysSinceLastReminder >= reminderIntervalDays;
};
feeDefaulterSchema.statics.getDefaultersNeedingReminders = async function (schoolId, reminderIntervalDays = 7) {
    const cutoffDate = new Date(Date.now() - reminderIntervalDays * 24 * 60 * 60 * 1000);
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
feeDefaulterSchema.virtual("severityLevel").get(function () {
    if (this.daysSinceFirstDue > 60 || this.totalDueAmount > 50000) {
        return "critical";
    }
    else if (this.daysSinceFirstDue > 30 || this.totalDueAmount > 20000) {
        return "high";
    }
    else if (this.daysSinceFirstDue > 14 || this.totalDueAmount > 10000) {
        return "medium";
    }
    return "low";
});
const FeeDefaulter = (0, mongoose_1.model)("FeeDefaulter", feeDefaulterSchema);
exports.default = FeeDefaulter;
//# sourceMappingURL=feeDefaulter.model.js.map