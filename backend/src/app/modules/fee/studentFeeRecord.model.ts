import { Schema, model } from "mongoose";
import {
  IStudentFeeRecord,
  PaymentStatus,
  Month,
  FeeType,
} from "./fee.interface";

const monthlyPaymentSchema = new Schema(
  {
    month: {
      type: Number,
      enum: Object.values(Month).filter((v) => typeof v === "number"),
      required: true,
    },
    dueAmount: {
      type: Number,
      required: true,
      min: [0, "Due amount must be non-negative"],
    },
    paidAmount: {
      type: Number,
      default: 0,
      min: [0, "Paid amount must be non-negative"],
    },
    status: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.PENDING,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    paidDate: {
      type: Date,
    },
    lateFee: {
      type: Number,
      default: 0,
      min: [0, "Late fee must be non-negative"],
    },
    waived: {
      type: Boolean,
      default: false,
    },
    waiverReason: {
      type: String,
      trim: true,
    },
    waiverBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    waiverDate: {
      type: Date,
    },
  },
  { _id: false }
);

const oneTimeFeeSchema = new Schema(
  {
    feeType: {
      type: String,
      enum: Object.values(FeeType),
      required: true,
    },
    dueAmount: {
      type: Number,
      required: true,
      min: [0, "Due amount must be non-negative"],
    },
    paidAmount: {
      type: Number,
      default: 0,
      min: [0, "Paid amount must be non-negative"],
    },
    status: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.PENDING,
    },
    dueDate: {
      type: Date,
      required: false, // Optional - one-time fees are paid with first payment
    },
    paidDate: {
      type: Date,
    },
    waived: {
      type: Boolean,
      default: false,
    },
    waiverReason: {
      type: String,
      trim: true,
    },
    waiverBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    waiverDate: {
      type: Date,
    },
  },
  { _id: false }
);

const studentFeeRecordSchema = new Schema<IStudentFeeRecord>(
  {
    student: {
      type: Schema.Types.ObjectId,
      ref: "Student",
      required: [true, "Student is required"],
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
    academicYear: {
      type: String,
      required: [true, "Academic year is required"],
      trim: true,
      match: [/^\d{4}-\d{4}$/, "Academic year must be in format YYYY-YYYY"],
      index: true,
    },
    feeStructure: {
      type: Schema.Types.ObjectId,
      ref: "FeeStructure",
      required: [true, "Fee structure is required"],
    },
    totalFeeAmount: {
      type: Number,
      required: true,
      min: [0, "Total fee amount must be non-negative"],
    },
    totalPaidAmount: {
      type: Number,
      default: 0,
      min: [0, "Total paid amount must be non-negative"],
    },
    totalDueAmount: {
      type: Number,
      required: true,
      min: [0, "Total due amount must be non-negative"],
    },
    monthlyPayments: {
      type: [monthlyPaymentSchema],
      validate: {
        validator: function (v: any[]) {
          return v && v.length === 12; // Must have 12 months
        },
        message: "Monthly payments must contain exactly 12 months",
      },
    },
    oneTimeFees: {
      type: [oneTimeFeeSchema],
      default: [],
    },
    status: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.PENDING,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound index for uniqueness (one record per student per year)
studentFeeRecordSchema.index({ student: 1, academicYear: 1 }, { unique: true });

// Index for querying overdue payments
studentFeeRecordSchema.index({ status: 1, "monthlyPayments.status": 1 });

// Pre-save middleware to update totals and status
studentFeeRecordSchema.pre("save", function (next) {
  // Calculate total paid amount from monthly payments
  const monthlyPaid = this.monthlyPayments.reduce(
    (sum, payment) => sum + payment.paidAmount,
    0
  );

  // Calculate total paid amount from one-time fees
  const oneTimePaid =
    this.oneTimeFees?.reduce(
      (sum: number, fee: any) => sum + (fee.paidAmount || 0),
      0
    ) || 0;

  // Total paid = monthly + one-time
  this.totalPaidAmount = monthlyPaid + oneTimePaid;

  // Calculate total due amount
  this.totalDueAmount = this.totalFeeAmount - this.totalPaidAmount;

  // Update overall status
  if (this.totalDueAmount === 0) {
    this.status = PaymentStatus.PAID;
  } else if (this.totalPaidAmount > 0) {
    this.status = PaymentStatus.PARTIAL;
  } else {
    // Check if any payment is overdue
    const now = new Date();
    const hasOverdue = this.monthlyPayments.some(
      (payment) =>
        payment.status === PaymentStatus.PENDING &&
        payment.dueDate < now &&
        !payment.waived
    );
    this.status = hasOverdue ? PaymentStatus.OVERDUE : PaymentStatus.PENDING;
  }

  next();
});

// Static method to create fee record for student
studentFeeRecordSchema.statics.createForStudent = async function (
  studentId: string,
  schoolId: string,
  grade: string,
  academicYear: string,
  feeStructureId: string,
  totalFeeAmount: number,
  dueDate: number = 10, // Default to 10th of month
  startMonth: Month = Month.APRIL
) {
  const monthlyAmount = Math.round(totalFeeAmount / 12);
  const monthlyPayments: any[] = [];

  // Ensure dueDate is valid (1-31), default to 10 if invalid
  const validDueDate = dueDate && dueDate >= 1 && dueDate <= 31 ? dueDate : 10;

  for (let i = 0; i < 12; i++) {
    const month = ((startMonth + i - 1) % 12) + 1;
    const year =
      parseInt(academicYear.split("-")[0]) + (month < startMonth ? 1 : 0);

    monthlyPayments.push({
      month,
      dueAmount: monthlyAmount,
      paidAmount: 0,
      status: PaymentStatus.PENDING,
      dueDate: new Date(year, month - 1, validDueDate),
      lateFee: 0,
      waived: false,
    });
  }

  return this.create({
    student: studentId,
    school: schoolId,
    grade,
    academicYear,
    feeStructure: feeStructureId,
    totalFeeAmount,
    totalPaidAmount: 0,
    totalDueAmount: totalFeeAmount,
    monthlyPayments,
    status: PaymentStatus.PENDING,
  });
};

// Method to record payment for a specific month
studentFeeRecordSchema.methods.recordPayment = async function (
  month: Month,
  amount: number
) {
  const monthlyPayment = this.monthlyPayments.find(
    (p: any) => p.month === month
  );

  if (!monthlyPayment) {
    throw new Error(`No payment record found for month ${month}`);
  }

  if (monthlyPayment.status === PaymentStatus.PAID) {
    throw new Error(`Payment for month ${month} is already completed`);
  }

  // Update payment record
  monthlyPayment.paidAmount += amount;
  monthlyPayment.paidDate = new Date();

  // Update status
  if (
    monthlyPayment.paidAmount >=
    monthlyPayment.dueAmount + monthlyPayment.lateFee
  ) {
    monthlyPayment.status = PaymentStatus.PAID;
  } else {
    monthlyPayment.status = PaymentStatus.PARTIAL;
  }

  return this.save();
};

// Method to apply late fee
studentFeeRecordSchema.methods.applyLateFee = async function (
  month: Month,
  lateFeePercentage: number
) {
  const monthlyPayment = this.monthlyPayments.find(
    (p: any) => p.month === month
  );

  if (!monthlyPayment) {
    throw new Error(`No payment record found for month ${month}`);
  }

  if (monthlyPayment.status === PaymentStatus.PAID || monthlyPayment.waived) {
    return this; // No late fee if already paid or waived
  }

  const now = new Date();
  if (now > monthlyPayment.dueDate) {
    monthlyPayment.lateFee = Math.round(
      (monthlyPayment.dueAmount * lateFeePercentage) / 100
    );
    monthlyPayment.status = PaymentStatus.OVERDUE;
  }

  return this.save();
};

// Method to waive fee for a specific month
studentFeeRecordSchema.methods.waiveFee = async function (
  month: Month,
  reason: string,
  waivedBy: string
) {
  const monthlyPayment = this.monthlyPayments.find(
    (p: any) => p.month === month
  );

  if (!monthlyPayment) {
    throw new Error(`No payment record found for month ${month}`);
  }

  monthlyPayment.waived = true;
  monthlyPayment.waiverReason = reason;
  monthlyPayment.waiverBy = waivedBy as any;
  monthlyPayment.waiverDate = new Date();
  monthlyPayment.status = PaymentStatus.WAIVED;

  return this.save();
};

// Method to get overdue months
studentFeeRecordSchema.methods.getOverdueMonths = function (): Month[] {
  const now = new Date();
  return this.monthlyPayments
    .filter(
      (p: any) =>
        p.status !== PaymentStatus.PAID &&
        p.status !== PaymentStatus.WAIVED &&
        p.dueDate < now
    )
    .map((p: any) => p.month);
};

// Static method to find defaulters
studentFeeRecordSchema.statics.findDefaulters = async function (
  schoolId: string,
  gracePeriodDays: number = 7
) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - gracePeriodDays);

  return this.find({
    school: schoolId,
    status: { $in: [PaymentStatus.OVERDUE, PaymentStatus.PARTIAL] },
    "monthlyPayments.dueDate": { $lt: cutoffDate },
    "monthlyPayments.status": {
      $in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL],
    },
  }).populate("student");
};

const StudentFeeRecord = model<IStudentFeeRecord>(
  "StudentFeeRecord",
  studentFeeRecordSchema
);

export default StudentFeeRecord;
