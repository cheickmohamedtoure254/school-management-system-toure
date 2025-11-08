"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = require("mongoose");
const fee_interface_1 = require("./fee.interface");
const monthlyPaymentSchema = new mongoose_1.Schema({
    month: {
        type: Number,
        enum: Object.values(fee_interface_1.Month).filter((v) => typeof v === "number"),
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
        enum: Object.values(fee_interface_1.PaymentStatus),
        default: fee_interface_1.PaymentStatus.PENDING,
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
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
    },
    waiverDate: {
        type: Date,
    },
}, { _id: false });
const oneTimeFeeSchema = new mongoose_1.Schema({
    feeType: {
        type: String,
        enum: Object.values(fee_interface_1.FeeType),
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
        enum: Object.values(fee_interface_1.PaymentStatus),
        default: fee_interface_1.PaymentStatus.PENDING,
    },
    dueDate: {
        type: Date,
        required: false,
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
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
    },
    waiverDate: {
        type: Date,
    },
}, { _id: false });
const studentFeeRecordSchema = new mongoose_1.Schema({
    student: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Student",
        required: [true, "Student is required"],
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
    academicYear: {
        type: String,
        required: [true, "Academic year is required"],
        trim: true,
        match: [/^\d{4}-\d{4}$/, "Academic year must be in format YYYY-YYYY"],
        index: true,
    },
    feeStructure: {
        type: mongoose_1.Schema.Types.ObjectId,
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
            validator: function (v) {
                return v && v.length === 12;
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
        enum: Object.values(fee_interface_1.PaymentStatus),
        default: fee_interface_1.PaymentStatus.PENDING,
        index: true,
    },
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});
studentFeeRecordSchema.index({ student: 1, academicYear: 1 }, { unique: true });
studentFeeRecordSchema.index({ status: 1, "monthlyPayments.status": 1 });
studentFeeRecordSchema.pre("save", function (next) {
    const monthlyPaid = this.monthlyPayments.reduce((sum, payment) => sum + payment.paidAmount, 0);
    const oneTimePaid = this.oneTimeFees?.reduce((sum, fee) => sum + (fee.paidAmount || 0), 0) || 0;
    this.totalPaidAmount = monthlyPaid + oneTimePaid;
    this.totalDueAmount = this.totalFeeAmount - this.totalPaidAmount;
    if (this.totalDueAmount === 0) {
        this.status = fee_interface_1.PaymentStatus.PAID;
    }
    else if (this.totalPaidAmount > 0) {
        this.status = fee_interface_1.PaymentStatus.PARTIAL;
    }
    else {
        const now = new Date();
        const hasOverdue = this.monthlyPayments.some((payment) => payment.status === fee_interface_1.PaymentStatus.PENDING &&
            payment.dueDate < now &&
            !payment.waived);
        this.status = hasOverdue ? fee_interface_1.PaymentStatus.OVERDUE : fee_interface_1.PaymentStatus.PENDING;
    }
    next();
});
studentFeeRecordSchema.statics.createForStudent = async function (studentId, schoolId, grade, academicYear, feeStructureId, totalFeeAmount, dueDate = 10, startMonth = fee_interface_1.Month.APRIL) {
    const monthlyAmount = Math.round(totalFeeAmount / 12);
    const monthlyPayments = [];
    const validDueDate = dueDate && dueDate >= 1 && dueDate <= 31 ? dueDate : 10;
    for (let i = 0; i < 12; i++) {
        const month = ((startMonth + i - 1) % 12) + 1;
        const year = parseInt(academicYear.split("-")[0]) + (month < startMonth ? 1 : 0);
        monthlyPayments.push({
            month,
            dueAmount: monthlyAmount,
            paidAmount: 0,
            status: fee_interface_1.PaymentStatus.PENDING,
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
        status: fee_interface_1.PaymentStatus.PENDING,
    });
};
studentFeeRecordSchema.methods.recordPayment = async function (month, amount) {
    const monthlyPayment = this.monthlyPayments.find((p) => p.month === month);
    if (!monthlyPayment) {
        throw new Error(`No payment record found for month ${month}`);
    }
    if (monthlyPayment.status === fee_interface_1.PaymentStatus.PAID) {
        throw new Error(`Payment for month ${month} is already completed`);
    }
    monthlyPayment.paidAmount += amount;
    monthlyPayment.paidDate = new Date();
    if (monthlyPayment.paidAmount >=
        monthlyPayment.dueAmount + monthlyPayment.lateFee) {
        monthlyPayment.status = fee_interface_1.PaymentStatus.PAID;
    }
    else {
        monthlyPayment.status = fee_interface_1.PaymentStatus.PARTIAL;
    }
    return this.save();
};
studentFeeRecordSchema.methods.applyLateFee = async function (month, lateFeePercentage) {
    const monthlyPayment = this.monthlyPayments.find((p) => p.month === month);
    if (!monthlyPayment) {
        throw new Error(`No payment record found for month ${month}`);
    }
    if (monthlyPayment.status === fee_interface_1.PaymentStatus.PAID || monthlyPayment.waived) {
        return this;
    }
    const now = new Date();
    if (now > monthlyPayment.dueDate) {
        monthlyPayment.lateFee = Math.round((monthlyPayment.dueAmount * lateFeePercentage) / 100);
        monthlyPayment.status = fee_interface_1.PaymentStatus.OVERDUE;
    }
    return this.save();
};
studentFeeRecordSchema.methods.waiveFee = async function (month, reason, waivedBy) {
    const monthlyPayment = this.monthlyPayments.find((p) => p.month === month);
    if (!monthlyPayment) {
        throw new Error(`No payment record found for month ${month}`);
    }
    monthlyPayment.waived = true;
    monthlyPayment.waiverReason = reason;
    monthlyPayment.waiverBy = waivedBy;
    monthlyPayment.waiverDate = new Date();
    monthlyPayment.status = fee_interface_1.PaymentStatus.WAIVED;
    return this.save();
};
studentFeeRecordSchema.methods.getOverdueMonths = function () {
    const now = new Date();
    return this.monthlyPayments
        .filter((p) => p.status !== fee_interface_1.PaymentStatus.PAID &&
        p.status !== fee_interface_1.PaymentStatus.WAIVED &&
        p.dueDate < now)
        .map((p) => p.month);
};
studentFeeRecordSchema.statics.findDefaulters = async function (schoolId, gracePeriodDays = 7) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - gracePeriodDays);
    return this.find({
        school: schoolId,
        status: { $in: [fee_interface_1.PaymentStatus.OVERDUE, fee_interface_1.PaymentStatus.PARTIAL] },
        "monthlyPayments.dueDate": { $lt: cutoffDate },
        "monthlyPayments.status": {
            $in: [fee_interface_1.PaymentStatus.PENDING, fee_interface_1.PaymentStatus.PARTIAL],
        },
    }).populate("student");
};
const StudentFeeRecord = (0, mongoose_1.model)("StudentFeeRecord", studentFeeRecordSchema);
exports.default = StudentFeeRecord;
//# sourceMappingURL=studentFeeRecord.model.js.map