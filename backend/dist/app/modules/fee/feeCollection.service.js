"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const studentFeeRecord_model_1 = __importDefault(require("./studentFeeRecord.model"));
const feeTransaction_model_1 = __importDefault(require("./feeTransaction.model"));
const feeStructure_model_1 = __importDefault(require("./feeStructure.model"));
const fee_interface_1 = require("./fee.interface");
const AppError_1 = require("../../errors/AppError");
const mongoose_1 = require("mongoose");
const Student = (0, mongoose_1.model)("Student");
class FeeCollectionService {
    async searchStudent(studentId, schoolId) {
        const student = await Student.findOne({
            studentId,
            schoolId: schoolId,
        })
            .populate("userId", "firstName lastName email phone")
            .select("studentId grade rollNumber userId");
        if (!student) {
            throw new AppError_1.AppError(404, "Student not found");
        }
        const userId = student.userId;
        const fullName = userId
            ? `${userId.firstName || ""} ${userId.lastName || ""}`.trim()
            : "Unknown";
        return {
            _id: student._id,
            studentId: student.studentId,
            name: fullName,
            grade: student.grade,
            rollNumber: student.rollNumber,
            parentContact: userId?.phone || "",
        };
    }
    async getStudentFeeStatus(studentId, schoolId, academicYear) {
        const student = await Student.findById(studentId)
            .populate("userId", "firstName lastName email phone")
            .select("studentId grade rollNumber userId schoolId");
        if (!student) {
            throw new AppError_1.AppError(404, "Student not found");
        }
        if (student.schoolId.toString() !== schoolId) {
            throw new AppError_1.AppError(403, "Access denied. Student belongs to a different school.");
        }
        const userId = student.userId;
        const studentName = userId
            ? `${userId.firstName || ""} ${userId.lastName || ""}`.trim()
            : "Unknown";
        const currentYear = academicYear || this.getCurrentAcademicYear();
        const latestFeeStructure = await feeStructure_model_1.default.findOne({
            school: schoolId,
            grade: student.grade,
            academicYear: currentYear,
            isActive: true,
        }).sort({ createdAt: -1 });
        if (!latestFeeStructure) {
            throw new AppError_1.AppError(404, `No fee structure has been set for Grade ${student.grade} in academic year ${currentYear}. Please ask the admin to create a fee structure for this grade first.`);
        }
        let feeRecord = await studentFeeRecord_model_1.default.findOne({
            student: student._id,
            academicYear: currentYear,
        }).populate("feeStructure");
        if (!feeRecord) {
            const oneTimeFeeTotal = latestFeeStructure.feeComponents
                .filter((c) => c.isOneTime)
                .reduce((sum, c) => sum + c.amount, 0);
            const totalYearlyFee = latestFeeStructure.totalAmount * 12 + oneTimeFeeTotal;
            feeRecord = await studentFeeRecord_model_1.default.create({
                student: student._id,
                school: schoolId,
                grade: student.grade,
                academicYear: currentYear,
                feeStructure: latestFeeStructure._id,
                totalFeeAmount: totalYearlyFee,
                totalPaidAmount: 0,
                totalDueAmount: totalYearlyFee,
                monthlyPayments: this.generateMonthlyPayments(latestFeeStructure.totalAmount, latestFeeStructure.dueDate, currentYear),
                oneTimeFees: latestFeeStructure.feeComponents
                    .filter((c) => c.isOneTime)
                    .map((c) => ({
                    feeType: c.feeType,
                    dueAmount: c.amount,
                    paidAmount: 0,
                    status: "pending",
                })),
                status: "pending",
            });
        }
        else {
            const currentStructureId = feeRecord.feeStructure?._id?.toString();
            const latestStructureId = latestFeeStructure._id.toString();
            if (currentStructureId !== latestStructureId) {
                const oneTimeFeeTotal = latestFeeStructure.feeComponents
                    .filter((c) => c.isOneTime)
                    .reduce((sum, c) => sum + c.amount, 0);
                const totalYearlyFee = latestFeeStructure.totalAmount * 12 + oneTimeFeeTotal;
                const totalPaid = feeRecord.totalPaidAmount;
                const newTotalDue = Math.max(0, totalYearlyFee - totalPaid);
                const newMonthlyPayments = this.generateMonthlyPayments(latestFeeStructure.totalAmount, latestFeeStructure.dueDate, currentYear);
                const paidMonths = feeRecord.monthlyPayments
                    .filter((p) => p.status === "paid")
                    .map((p) => p.month);
                newMonthlyPayments.forEach((payment) => {
                    if (paidMonths.includes(payment.month)) {
                        payment.status = "paid";
                        payment.paidAmount = payment.dueAmount;
                    }
                });
                const newOneTimeFees = latestFeeStructure.feeComponents
                    .filter((c) => c.isOneTime)
                    .map((c) => {
                    const oldFee = feeRecord?.oneTimeFees?.find((f) => f.feeType === c.feeType);
                    if (oldFee && oldFee.status === "paid") {
                        return {
                            feeType: c.feeType,
                            dueAmount: c.amount,
                            paidAmount: c.amount,
                            status: "paid",
                        };
                    }
                    return {
                        feeType: c.feeType,
                        dueAmount: c.amount,
                        paidAmount: 0,
                        status: "pending",
                    };
                });
                await studentFeeRecord_model_1.default.updateOne({ _id: feeRecord._id }, {
                    $set: {
                        feeStructure: latestFeeStructure._id,
                        totalFeeAmount: totalYearlyFee,
                        totalDueAmount: newTotalDue,
                        monthlyPayments: newMonthlyPayments,
                        oneTimeFees: newOneTimeFees,
                    },
                });
                feeRecord = await studentFeeRecord_model_1.default.findById(feeRecord._id).populate("feeStructure");
                if (!feeRecord) {
                    throw new AppError_1.AppError(500, "Failed to reload updated fee record");
                }
            }
        }
        const now = new Date();
        const upcomingDue = feeRecord.monthlyPayments.find((p) => (p.status === "pending" || p.status === "overdue") && !p.waived);
        const recentTransactions = await feeTransaction_model_1.default.find({
            student: student._id,
            studentFeeRecord: feeRecord._id,
        })
            .sort({ createdAt: -1 })
            .limit(10)
            .populate("collectedBy", "firstName lastName email");
        return {
            student: {
                _id: student._id,
                studentId: student.studentId,
                name: studentName,
                grade: student.grade,
                rollNumber: student.rollNumber,
            },
            feeRecord,
            upcomingDue: upcomingDue
                ? {
                    month: upcomingDue.month,
                    amount: upcomingDue.dueAmount,
                    dueDate: upcomingDue.dueDate,
                }
                : undefined,
            recentTransactions,
        };
    }
    async validateFeeCollection(studentId, schoolId, month, amount, includeLateFee = false) {
        const status = await this.getStudentFeeStatus(studentId, schoolId);
        const monthlyPayment = status.feeRecord.monthlyPayments.find((p) => p.month === month);
        if (!monthlyPayment) {
            throw new AppError_1.AppError(400, "Invalid month selected");
        }
        const warnings = [];
        const errors = [];
        if (monthlyPayment.status === "paid") {
            errors.push("This month's fee is already fully paid");
        }
        if (monthlyPayment.waived) {
            errors.push("This month's fee has been waived");
        }
        const isFirstPayment = status.feeRecord.totalPaidAmount === 0;
        const pendingOneTimeFees = status.feeRecord.oneTimeFees?.filter((f) => f.status === "pending" || f.status === "partial") || [];
        let totalOneTimeFeeAmount = 0;
        if (isFirstPayment && pendingOneTimeFees.length > 0) {
            totalOneTimeFeeAmount = pendingOneTimeFees.reduce((sum, f) => sum + (f.dueAmount - f.paidAmount), 0);
            warnings.push(`First payment must include ₹${totalOneTimeFeeAmount} one-time fees (${pendingOneTimeFees
                .map((f) => f.feeType)
                .join(", ")})`);
        }
        const lateFeeAmount = includeLateFee ? monthlyPayment.lateFee || 0 : 0;
        const monthlyExpectedAmount = monthlyPayment.dueAmount - monthlyPayment.paidAmount + lateFeeAmount;
        const totalExpectedAmount = monthlyExpectedAmount + totalOneTimeFeeAmount;
        if (amount > totalExpectedAmount) {
            warnings.push(`Amount exceeds due amount. Due: ₹${totalExpectedAmount} (Monthly: ₹${monthlyExpectedAmount}${totalOneTimeFeeAmount > 0
                ? ` + One-time: ₹${totalOneTimeFeeAmount}`
                : ""}), Received: ₹${amount}`);
        }
        if (amount < totalExpectedAmount) {
            if (isFirstPayment && amount < totalOneTimeFeeAmount) {
                errors.push(`Insufficient amount. First payment must be at least ₹${totalOneTimeFeeAmount} to cover one-time fees. You can pay the monthly fee partially after that.`);
            }
            else {
                warnings.push(`Partial payment. Due: ₹${totalExpectedAmount}, Received: ₹${amount}, Remaining: ₹${totalExpectedAmount - amount}`);
            }
        }
        const now = new Date();
        if (monthlyPayment.dueDate < now && monthlyPayment.status === "pending") {
            warnings.push(`Payment is overdue by ${Math.floor((now.getTime() - monthlyPayment.dueDate.getTime()) /
                (1000 * 60 * 60 * 24))} days`);
        }
        const previousMonths = status.feeRecord.monthlyPayments.filter((p) => p.month < month && p.status !== "paid" && !p.waived);
        if (previousMonths.length > 0) {
            warnings.push(`${previousMonths.length} previous month(s) are still pending`);
        }
        return {
            valid: errors.length === 0,
            warnings,
            errors,
            monthlyPayment: {
                month: monthlyPayment.month,
                dueAmount: monthlyPayment.dueAmount,
                paidAmount: monthlyPayment.paidAmount,
                lateFee: monthlyPayment.lateFee,
                status: monthlyPayment.status,
                dueDate: monthlyPayment.dueDate,
            },
            expectedAmount: totalExpectedAmount,
            monthlyExpectedAmount,
            totalOneTimeFeeAmount,
            lateFeeAmount,
            includeLateFee,
            isFirstPayment,
            pendingOneTimeFees: pendingOneTimeFees.map((f) => ({
                feeType: f.feeType,
                amount: f.dueAmount - f.paidAmount,
            })),
        };
    }
    async collectFee(data) {
        const validation = await this.validateFeeCollection(data.studentId, data.schoolId, data.month, data.amount, data.includeLateFee || false);
        if (!validation.valid) {
            throw new AppError_1.AppError(400, validation.errors.join("; "));
        }
        const status = await this.getStudentFeeStatus(data.studentId, data.schoolId);
        const isFirstPayment = status.feeRecord.totalPaidAmount === 0;
        const pendingOneTimeFees = status.feeRecord.oneTimeFees?.filter((f) => f.status === "pending" || f.status === "partial") || [];
        let totalOneTimeFeeAmount = 0;
        if (isFirstPayment && pendingOneTimeFees.length > 0) {
            totalOneTimeFeeAmount = pendingOneTimeFees.reduce((sum, f) => sum + (f.dueAmount - f.paidAmount), 0);
        }
        const monthlyPaymentAmount = data.amount - totalOneTimeFeeAmount;
        if (monthlyPaymentAmount < 0) {
            throw new AppError_1.AppError(400, `Amount must be at least ₹${totalOneTimeFeeAmount} to cover one-time fees`);
        }
        if (monthlyPaymentAmount > 0) {
            await status.feeRecord.recordPayment(data.month, monthlyPaymentAmount);
        }
        const oneTimeFeeTransactions = [];
        if (isFirstPayment && totalOneTimeFeeAmount > 0) {
            for (const oneTimeFee of pendingOneTimeFees) {
                const amountToPay = oneTimeFee.dueAmount - oneTimeFee.paidAmount;
                oneTimeFee.paidAmount += amountToPay;
                oneTimeFee.paidDate = new Date();
                oneTimeFee.status = fee_interface_1.PaymentStatus.PAID;
                const oneTimeTxn = await feeTransaction_model_1.default.create({
                    transactionId: `TXN-${Date.now()}-${Math.random()
                        .toString(36)
                        .substring(7)
                        .toUpperCase()}`,
                    student: status.student._id,
                    studentFeeRecord: status.feeRecord._id,
                    school: data.schoolId,
                    transactionType: fee_interface_1.TransactionType.PAYMENT,
                    amount: amountToPay,
                    paymentMethod: data.paymentMethod,
                    feeType: oneTimeFee.feeType,
                    collectedBy: data.collectedBy,
                    remarks: `One-time fee (${oneTimeFee.feeType}) - Collected with first payment`,
                    status: "completed",
                    auditLog: {
                        ipAddress: data.auditInfo?.ipAddress,
                        deviceInfo: data.auditInfo?.deviceInfo,
                        timestamp: new Date(),
                    },
                });
                oneTimeFeeTransactions.push(oneTimeTxn);
            }
            status.feeRecord.markModified("oneTimeFees");
            await status.feeRecord.save();
        }
        const transaction = await feeTransaction_model_1.default.create({
            transactionId: `TXN-${Date.now()}-${Math.random()
                .toString(36)
                .substring(7)
                .toUpperCase()}`,
            student: status.student._id,
            studentFeeRecord: status.feeRecord._id,
            school: data.schoolId,
            transactionType: fee_interface_1.TransactionType.PAYMENT,
            amount: monthlyPaymentAmount > 0 ? monthlyPaymentAmount : data.amount,
            paymentMethod: data.paymentMethod,
            month: data.month,
            collectedBy: data.collectedBy,
            remarks: data.remarks ||
                (isFirstPayment && totalOneTimeFeeAmount > 0
                    ? `First payment including ₹${totalOneTimeFeeAmount} one-time fees`
                    : undefined),
            status: "completed",
            auditLog: {
                ipAddress: data.auditInfo?.ipAddress,
                deviceInfo: data.auditInfo?.deviceInfo,
                timestamp: new Date(),
            },
        });
        return {
            success: true,
            transaction,
            oneTimeFeeTransactions,
            feeRecord: status.feeRecord,
            warnings: validation.warnings,
            isFirstPayment,
            totalOneTimeFeeAmount,
        };
    }
    async getAccountantTransactions(accountantId, schoolId, startDate, endDate) {
        const transactions = await feeTransaction_model_1.default.find({
            school: schoolId,
            collectedBy: accountantId,
            createdAt: { $gte: startDate, $lte: endDate },
        })
            .populate({
            path: "student",
            select: "studentId grade section rollNumber userId",
            populate: {
                path: "userId",
                select: "firstName lastName email phone",
            },
        })
            .sort({ createdAt: -1 })
            .lean();
        return transactions.map((t) => {
            const userId = t.student?.userId;
            const studentName = userId
                ? `${userId.firstName || ""} ${userId.lastName || ""}`.trim()
                : "Unknown";
            return {
                _id: t._id,
                transactionId: t.transactionId,
                studentId: t.student?.studentId,
                studentName,
                grade: t.student?.grade,
                section: t.student?.section,
                amount: t.amount,
                paymentMethod: t.paymentMethod,
                date: t.createdAt,
                month: t.month,
                status: t.status,
                remarks: t.remarks,
            };
        });
    }
    async getDailyCollectionSummary(accountantId, schoolId, date) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);
        const summary = await feeTransaction_model_1.default.aggregate([
            {
                $match: {
                    school: schoolId,
                    collectedBy: accountantId,
                    transactionType: fee_interface_1.TransactionType.PAYMENT,
                    status: "completed",
                    createdAt: { $gte: startOfDay, $lte: endOfDay },
                },
            },
            {
                $group: {
                    _id: "$paymentMethod",
                    totalAmount: { $sum: "$amount" },
                    count: { $sum: 1 },
                },
            },
        ]);
        const totalCollected = summary.reduce((sum, s) => sum + s.totalAmount, 0);
        const totalTransactions = summary.reduce((sum, s) => sum + s.count, 0);
        return {
            date,
            totalCollected,
            totalTransactions,
            byPaymentMethod: summary,
        };
    }
    async getAccountantDashboard(accountantId, schoolId) {
        const today = new Date();
        const startOfDay = new Date(today);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(today);
        endOfDay.setHours(23, 59, 59, 999);
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
        const schoolObjectId = new mongoose_1.Types.ObjectId(schoolId);
        const todayCollections = await feeTransaction_model_1.default.aggregate([
            {
                $match: {
                    school: schoolObjectId,
                    transactionType: fee_interface_1.TransactionType.PAYMENT,
                    status: "completed",
                    createdAt: { $gte: startOfDay, $lte: endOfDay },
                },
            },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: "$amount" },
                    count: { $sum: 1 },
                },
            },
        ]);
        const monthCollections = await feeTransaction_model_1.default.aggregate([
            {
                $match: {
                    school: schoolObjectId,
                    transactionType: fee_interface_1.TransactionType.PAYMENT,
                    status: "completed",
                    createdAt: { $gte: startOfMonth, $lte: endOfMonth },
                },
            },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: "$amount" },
                    count: { $sum: 1 },
                },
            },
        ]);
        const pendingDues = await studentFeeRecord_model_1.default.aggregate([
            {
                $match: {
                    school: schoolObjectId,
                    academicYear: this.getCurrentAcademicYear(),
                },
            },
            {
                $group: {
                    _id: null,
                    totalDue: { $sum: "$totalDueAmount" },
                    count: { $sum: 1 },
                },
            },
        ]);
        const defaultersCount = await studentFeeRecord_model_1.default.countDocuments({
            school: schoolObjectId,
            academicYear: this.getCurrentAcademicYear(),
            monthlyPayments: {
                $elemMatch: {
                    status: "overdue",
                    waived: false,
                },
            },
        });
        const recentTransactions = await feeTransaction_model_1.default.find({
            school: schoolObjectId,
            transactionType: fee_interface_1.TransactionType.PAYMENT,
            status: "completed",
        })
            .populate({
            path: "student",
            select: "studentId grade section rollNumber userId",
            populate: {
                path: "userId",
                select: "firstName lastName email phone",
            },
        })
            .sort({ createdAt: -1 })
            .limit(10);
        const monthlyBreakdown = await feeTransaction_model_1.default.aggregate([
            {
                $match: {
                    school: schoolId,
                    transactionType: fee_interface_1.TransactionType.PAYMENT,
                    status: "completed",
                    createdAt: { $gte: startOfMonth, $lte: endOfMonth },
                },
            },
            {
                $lookup: {
                    from: "feesstructures",
                    localField: "studentFeeRecord",
                    foreignField: "_id",
                    as: "feeStructure",
                },
            },
            {
                $unwind: { path: "$feeStructure", preserveNullAndEmptyArrays: true },
            },
            {
                $group: {
                    _id: "$paymentMethod",
                    totalAmount: { $sum: "$amount" },
                    count: { $sum: 1 },
                },
            },
        ]);
        const feeTypeBreakdown = await studentFeeRecord_model_1.default.aggregate([
            {
                $match: {
                    school: schoolObjectId,
                    academicYear: this.getCurrentAcademicYear(),
                },
            },
            {
                $unwind: "$monthlyPayments",
            },
            {
                $match: {
                    "monthlyPayments.paidAmount": { $gt: 0 },
                    "monthlyPayments.paidDate": { $gte: startOfMonth, $lte: endOfMonth },
                },
            },
            {
                $lookup: {
                    from: "feesstructures",
                    localField: "feeStructure",
                    foreignField: "_id",
                    as: "structure",
                },
            },
            {
                $unwind: { path: "$structure", preserveNullAndEmptyArrays: true },
            },
            {
                $group: {
                    _id: null,
                    tuitionFee: {
                        $sum: {
                            $cond: [
                                { $gt: ["$structure.tuitionFee", 0] },
                                {
                                    $multiply: [
                                        "$monthlyPayments.paidAmount",
                                        {
                                            $divide: [
                                                "$structure.tuitionFee",
                                                {
                                                    $add: [
                                                        "$structure.tuitionFee",
                                                        "$structure.computerFee",
                                                        "$structure.examFee",
                                                        "$structure.sportsFee",
                                                        "$structure.libraryFee",
                                                        "$structure.transportFee",
                                                        "$structure.otherFees",
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                0,
                            ],
                        },
                    },
                    examFee: {
                        $sum: {
                            $cond: [
                                { $gt: ["$structure.examFee", 0] },
                                {
                                    $multiply: [
                                        "$monthlyPayments.paidAmount",
                                        {
                                            $divide: [
                                                "$structure.examFee",
                                                {
                                                    $add: [
                                                        "$structure.tuitionFee",
                                                        "$structure.computerFee",
                                                        "$structure.examFee",
                                                        "$structure.sportsFee",
                                                        "$structure.libraryFee",
                                                        "$structure.transportFee",
                                                        "$structure.otherFees",
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                0,
                            ],
                        },
                    },
                    transportFee: {
                        $sum: {
                            $cond: [
                                { $gt: ["$structure.transportFee", 0] },
                                {
                                    $multiply: [
                                        "$monthlyPayments.paidAmount",
                                        {
                                            $divide: [
                                                "$structure.transportFee",
                                                {
                                                    $add: [
                                                        "$structure.tuitionFee",
                                                        "$structure.computerFee",
                                                        "$structure.examFee",
                                                        "$structure.sportsFee",
                                                        "$structure.libraryFee",
                                                        "$structure.transportFee",
                                                        "$structure.otherFees",
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                0,
                            ],
                        },
                    },
                    otherFees: {
                        $sum: {
                            $cond: [
                                {
                                    $gt: [
                                        {
                                            $add: [
                                                "$structure.computerFee",
                                                "$structure.sportsFee",
                                                "$structure.libraryFee",
                                                "$structure.otherFees",
                                            ],
                                        },
                                        0,
                                    ],
                                },
                                {
                                    $multiply: [
                                        "$monthlyPayments.paidAmount",
                                        {
                                            $divide: [
                                                {
                                                    $add: [
                                                        "$structure.computerFee",
                                                        "$structure.sportsFee",
                                                        "$structure.libraryFee",
                                                        "$structure.otherFees",
                                                    ],
                                                },
                                                {
                                                    $add: [
                                                        "$structure.tuitionFee",
                                                        "$structure.computerFee",
                                                        "$structure.examFee",
                                                        "$structure.sportsFee",
                                                        "$structure.libraryFee",
                                                        "$structure.transportFee",
                                                        "$structure.otherFees",
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                0,
                            ],
                        },
                    },
                },
            },
        ]);
        const breakdown = feeTypeBreakdown[0] || {};
        return {
            totalCollections: monthCollections[0]?.totalAmount || 0,
            todayTransactions: todayCollections[0]?.totalAmount || 0,
            monthlyTarget: (monthCollections[0]?.totalAmount || 0) * 1.2,
            monthlyTransactions: monthCollections[0]?.totalAmount || 0,
            pendingDues: pendingDues[0]?.totalDue || 0,
            totalDefaulters: defaultersCount,
            recentTransactions: recentTransactions.map((t) => {
                const userId = t.student?.userId;
                const studentName = userId
                    ? `${userId.firstName || ""} ${userId.lastName || ""}`.trim()
                    : "Unknown";
                return {
                    _id: t._id,
                    transactionId: t.transactionId,
                    studentName,
                    studentId: t.student?.studentId,
                    grade: t.student?.grade,
                    section: t.student?.section,
                    amount: t.amount,
                    paymentMethod: t.paymentMethod,
                    date: t.createdAt,
                    month: t.month,
                };
            }),
            tuitionCollection: Math.round(breakdown.tuitionFee || 0),
            examCollection: Math.round(breakdown.examFee || 0),
            transportCollection: Math.round(breakdown.transportFee || 0),
            otherCollection: Math.round(breakdown.otherFees || 0),
            monthlyBreakdown,
        };
    }
    async getStudentsByGradeSection(schoolId, grade, section) {
        const query = { schoolId: schoolId, isActive: true };
        if (grade)
            query.grade = grade;
        if (section)
            query.section = section;
        const students = await Student.find(query)
            .populate("userId", "firstName lastName email phone")
            .select("studentId grade section rollNumber userId")
            .sort({ grade: 1, section: 1, rollNumber: 1 })
            .lean();
        const studentsWithFees = await Promise.all(students.map(async (student) => {
            const currentYear = this.getCurrentAcademicYear();
            let feeRecord = await studentFeeRecord_model_1.default.findOne({
                student: student._id,
                academicYear: currentYear,
            });
            if (!feeRecord) {
                try {
                    const latestFeeStructure = await feeStructure_model_1.default.findOne({
                        school: schoolId,
                        grade: student.grade,
                        academicYear: currentYear,
                        isActive: true,
                    }).sort({ createdAt: -1 });
                    if (latestFeeStructure) {
                        const oneTimeFeeTotal = latestFeeStructure.feeComponents
                            .filter((c) => c.isOneTime)
                            .reduce((sum, c) => sum + c.amount, 0);
                        const totalYearlyFee = latestFeeStructure.totalAmount * 12 + oneTimeFeeTotal;
                        feeRecord = await studentFeeRecord_model_1.default.create({
                            student: student._id,
                            school: schoolId,
                            grade: student.grade,
                            academicYear: currentYear,
                            feeStructure: latestFeeStructure._id,
                            totalFeeAmount: totalYearlyFee,
                            totalPaidAmount: 0,
                            totalDueAmount: totalYearlyFee,
                            monthlyPayments: this.generateMonthlyPayments(latestFeeStructure.totalAmount, latestFeeStructure.dueDate, currentYear),
                            oneTimeFees: latestFeeStructure.feeComponents
                                .filter((c) => c.isOneTime)
                                .map((c) => ({
                                feeType: c.feeType,
                                dueAmount: c.amount,
                                paidAmount: 0,
                                status: "pending",
                            })),
                            status: "pending",
                        });
                    }
                }
                catch (error) {
                }
            }
            const userId = student.userId;
            const fullName = userId
                ? `${userId.firstName || ""} ${userId.lastName || ""}`.trim()
                : "Unknown";
            let calculatedTotalPaid = 0;
            let calculatedTotalDue = 0;
            if (feeRecord) {
                const monthlyPaid = feeRecord.monthlyPayments.reduce((sum, payment) => sum + (payment.paidAmount || 0), 0);
                const oneTimePaid = (feeRecord.oneTimeFees || []).reduce((sum, fee) => sum + (fee.paidAmount || 0), 0);
                calculatedTotalPaid = monthlyPaid + oneTimePaid;
                calculatedTotalDue = feeRecord.totalFeeAmount - calculatedTotalPaid;
            }
            return {
                _id: student._id,
                studentId: student.studentId,
                name: fullName,
                grade: student.grade,
                section: student.section,
                rollNumber: student.rollNumber,
                parentContact: userId?.phone || "",
                feeStatus: feeRecord
                    ? {
                        totalFeeAmount: feeRecord.totalFeeAmount,
                        totalPaidAmount: calculatedTotalPaid,
                        totalDueAmount: calculatedTotalDue,
                        status: feeRecord.status,
                        pendingMonths: feeRecord.monthlyPayments.filter((p) => p.status === "pending" || p.status === "overdue").length,
                    }
                    : null,
            };
        }));
        return studentsWithFees;
    }
    async getDefaulters(schoolId) {
        const currentYear = this.getCurrentAcademicYear();
        const schoolObjectId = new mongoose_1.Types.ObjectId(schoolId);
        const defaulters = await studentFeeRecord_model_1.default.find({
            school: schoolObjectId,
            academicYear: currentYear,
            monthlyPayments: {
                $elemMatch: {
                    status: "overdue",
                    waived: false,
                },
            },
        })
            .populate({
            path: "student",
            select: "studentId grade section rollNumber userId",
            populate: {
                path: "userId",
                select: "firstName lastName email phone",
            },
        })
            .sort({ totalDueAmount: -1 })
            .lean();
        return defaulters.map((record) => {
            const userId = record.student?.userId;
            const studentName = userId
                ? `${userId.firstName || ""} ${userId.lastName || ""}`.trim()
                : "Unknown";
            const overdueMonths = record.monthlyPayments.filter((p) => p.status === "overdue" && !p.waived);
            return {
                _id: record._id,
                studentId: record.student?.studentId,
                studentName,
                grade: record.student?.grade,
                section: record.student?.section,
                rollNumber: record.student?.rollNumber,
                parentContact: userId?.phone || "",
                totalDueAmount: record.totalDueAmount,
                totalOverdue: overdueMonths.reduce((sum, m) => sum + m.dueAmount, 0),
                overdueMonths: overdueMonths.length,
                lastPaymentDate: record.lastPaymentDate,
                feeStatus: record.status,
            };
        });
    }
    async getFinancialReports(schoolId, reportType = "monthly", startDate, endDate) {
        const schoolObjectId = new mongoose_1.Types.ObjectId(schoolId);
        const now = new Date();
        let start, end;
        switch (reportType) {
            case "daily":
                start = startDate ? new Date(startDate) : new Date(now);
                start.setHours(0, 0, 0, 0);
                end = endDate ? new Date(endDate) : new Date(now);
                end.setHours(23, 59, 59, 999);
                break;
            case "weekly":
                start = startDate ? new Date(startDate) : new Date(now);
                start.setDate(start.getDate() - 7);
                start.setHours(0, 0, 0, 0);
                end = endDate ? new Date(endDate) : new Date(now);
                end.setHours(23, 59, 59, 999);
                break;
            case "monthly":
                start = startDate
                    ? new Date(startDate)
                    : new Date(now.getFullYear(), now.getMonth(), 1);
                end = endDate
                    ? new Date(endDate)
                    : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
                break;
            case "yearly":
                start = startDate
                    ? new Date(startDate)
                    : new Date(now.getFullYear(), 0, 1);
                end = endDate
                    ? new Date(endDate)
                    : new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
                break;
            default:
                start = new Date(now.getFullYear(), now.getMonth(), 1);
                end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        }
        const totalCollections = await feeTransaction_model_1.default.aggregate([
            {
                $match: {
                    school: schoolObjectId,
                    transactionType: fee_interface_1.TransactionType.PAYMENT,
                    status: "completed",
                    createdAt: { $gte: start, $lte: end },
                },
            },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: "$amount" },
                    count: { $sum: 1 },
                },
            },
        ]);
        const byPaymentMethod = await feeTransaction_model_1.default.aggregate([
            {
                $match: {
                    school: schoolObjectId,
                    transactionType: fee_interface_1.TransactionType.PAYMENT,
                    status: "completed",
                    createdAt: { $gte: start, $lte: end },
                },
            },
            {
                $group: {
                    _id: "$paymentMethod",
                    totalAmount: { $sum: "$amount" },
                    count: { $sum: 1 },
                },
            },
        ]);
        const dailyBreakdown = await feeTransaction_model_1.default.aggregate([
            {
                $match: {
                    school: schoolObjectId,
                    transactionType: fee_interface_1.TransactionType.PAYMENT,
                    status: "completed",
                    createdAt: { $gte: start, $lte: end },
                },
            },
            {
                $group: {
                    _id: {
                        year: { $year: "$createdAt" },
                        month: { $month: "$createdAt" },
                        day: { $dayOfMonth: "$createdAt" },
                    },
                    totalAmount: { $sum: "$amount" },
                    count: { $sum: 1 },
                },
            },
            {
                $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 },
            },
        ]);
        const byGrade = await feeTransaction_model_1.default.aggregate([
            {
                $match: {
                    school: schoolObjectId,
                    transactionType: fee_interface_1.TransactionType.PAYMENT,
                    status: "completed",
                    createdAt: { $gte: start, $lte: end },
                },
            },
            {
                $lookup: {
                    from: "students",
                    localField: "student",
                    foreignField: "_id",
                    as: "studentData",
                },
            },
            {
                $unwind: "$studentData",
            },
            {
                $group: {
                    _id: "$studentData.grade",
                    totalAmount: { $sum: "$amount" },
                    count: { $sum: 1 },
                },
            },
            {
                $sort: { _id: 1 },
            },
        ]);
        const topAccountants = await feeTransaction_model_1.default.aggregate([
            {
                $match: {
                    school: schoolObjectId,
                    transactionType: fee_interface_1.TransactionType.PAYMENT,
                    status: "completed",
                    createdAt: { $gte: start, $lte: end },
                },
            },
            {
                $group: {
                    _id: "$collectedBy",
                    totalAmount: { $sum: "$amount" },
                    count: { $sum: 1 },
                },
            },
            {
                $sort: { totalAmount: -1 },
            },
            {
                $limit: 5,
            },
            {
                $lookup: {
                    from: "users",
                    localField: "_id",
                    foreignField: "_id",
                    as: "accountant",
                },
            },
            {
                $unwind: "$accountant",
            },
            {
                $project: {
                    accountantName: {
                        $concat: ["$accountant.firstName", " ", "$accountant.lastName"],
                    },
                    totalAmount: 1,
                    count: 1,
                },
            },
        ]);
        return {
            reportType,
            period: {
                start,
                end,
            },
            summary: {
                totalAmount: totalCollections[0]?.totalAmount || 0,
                totalTransactions: totalCollections[0]?.count || 0,
                averageTransaction: totalCollections[0]?.count > 0
                    ? totalCollections[0].totalAmount / totalCollections[0].count
                    : 0,
            },
            byPaymentMethod,
            dailyBreakdown,
            byGrade,
            topAccountants,
        };
    }
    getCurrentAcademicYear() {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        if (currentMonth >= 4) {
            return `${currentYear}-${currentYear + 1}`;
        }
        else {
            return `${currentYear - 1}-${currentYear}`;
        }
    }
    generateMonthlyPayments(monthlyAmount, dueDate = 10, academicYear) {
        const payments = [];
        const startYear = parseInt(academicYear.split("-")[0]);
        const validDueDate = dueDate && dueDate >= 1 && dueDate <= 31 ? dueDate : 10;
        for (let i = 0; i < 12; i++) {
            const month = ((fee_interface_1.Month.APRIL + i - 1) % 12) + 1;
            const year = startYear + (month < fee_interface_1.Month.APRIL ? 1 : 0);
            payments.push({
                month,
                dueAmount: monthlyAmount,
                paidAmount: 0,
                status: "pending",
                dueDate: new Date(year, month - 1, validDueDate),
                lateFee: 0,
                waived: false,
            });
        }
        return payments;
    }
    async collectOneTimeFee(data) {
        const schoolObjectId = new mongoose_1.Types.ObjectId(data.schoolId);
        const student = await Student.findOne({
            studentId: data.studentId,
            schoolId: data.schoolId,
        });
        if (!student) {
            throw new AppError_1.AppError(404, "Student not found");
        }
        const feeRecord = await studentFeeRecord_model_1.default.findOne({
            student: student._id,
            school: schoolObjectId,
            academicYear: this.getCurrentAcademicYear(),
        });
        if (!feeRecord) {
            throw new AppError_1.AppError(404, "Student fee record not found");
        }
        const oneTimeFeeIndex = feeRecord.oneTimeFees?.findIndex((fee) => fee.feeType === data.feeType && fee.status !== fee_interface_1.PaymentStatus.PAID);
        if (oneTimeFeeIndex === undefined ||
            oneTimeFeeIndex === -1 ||
            !feeRecord.oneTimeFees) {
            throw new AppError_1.AppError(404, `${data.feeType} fee not found or already paid`);
        }
        const oneTimeFee = feeRecord.oneTimeFees[oneTimeFeeIndex];
        const remainingAmount = oneTimeFee.dueAmount - oneTimeFee.paidAmount;
        if (data.amount > remainingAmount) {
            throw new AppError_1.AppError(400, `Payment amount (${data.amount}) exceeds remaining due amount (${remainingAmount})`);
        }
        feeRecord.oneTimeFees[oneTimeFeeIndex].paidAmount =
            (feeRecord.oneTimeFees[oneTimeFeeIndex].paidAmount || 0) + data.amount;
        if (feeRecord.oneTimeFees[oneTimeFeeIndex].paidAmount >=
            feeRecord.oneTimeFees[oneTimeFeeIndex].dueAmount) {
            feeRecord.oneTimeFees[oneTimeFeeIndex].status = fee_interface_1.PaymentStatus.PAID;
            feeRecord.oneTimeFees[oneTimeFeeIndex].paidDate = new Date();
        }
        else {
            feeRecord.oneTimeFees[oneTimeFeeIndex].status = fee_interface_1.PaymentStatus.PARTIAL;
        }
        feeRecord.markModified("oneTimeFees");
        feeRecord.totalPaidAmount += data.amount;
        feeRecord.totalDueAmount -= data.amount;
        if (feeRecord.totalDueAmount === 0) {
            feeRecord.status = fee_interface_1.PaymentStatus.PAID;
        }
        else if (feeRecord.totalPaidAmount > 0) {
            feeRecord.status = fee_interface_1.PaymentStatus.PARTIAL;
        }
        await feeRecord.save();
        const transaction = await feeTransaction_model_1.default.create({
            transactionId: `TXN-${Date.now()}-${Math.random()
                .toString(36)
                .substring(7)
                .toUpperCase()}`,
            student: student._id,
            studentFeeRecord: feeRecord._id,
            school: schoolObjectId,
            transactionType: fee_interface_1.TransactionType.PAYMENT,
            amount: data.amount,
            paymentMethod: data.paymentMethod,
            collectedBy: data.collectedBy,
            remarks: data.remarks || `${data.feeType} fee payment`,
            status: "completed",
            auditLog: {
                ipAddress: data.auditInfo?.ipAddress,
                deviceInfo: data.auditInfo?.deviceInfo,
                timestamp: new Date(),
            },
        });
        return {
            success: true,
            transaction,
            feeRecord,
            oneTimeFee: {
                feeType: oneTimeFee.feeType,
                dueAmount: oneTimeFee.dueAmount,
                paidAmount: oneTimeFee.paidAmount,
                status: oneTimeFee.status,
                remainingAmount: oneTimeFee.dueAmount - oneTimeFee.paidAmount,
            },
        };
    }
    async getStudentFeeStatusDetailed(studentId, schoolId) {
        const schoolObjectId = new mongoose_1.Types.ObjectId(schoolId);
        const student = await Student.findOne({
            studentId,
            schoolId: schoolId,
        })
            .populate("userId", "firstName lastName email phone")
            .lean();
        if (!student) {
            throw new AppError_1.AppError(404, "Student not found");
        }
        const feeRecord = await studentFeeRecord_model_1.default.findOne({
            student: student._id,
            school: schoolObjectId,
            academicYear: this.getCurrentAcademicYear(),
        })
            .populate("feeStructure")
            .lean();
        if (!feeRecord) {
            return {
                student: {
                    _id: student._id,
                    studentId: student.studentId,
                    name: `${student.userId?.firstName || ""} ${student.userId?.lastName || ""}`.trim(),
                    grade: student.grade,
                    rollNumber: student.rollNumber,
                },
                hasFeeRecord: false,
                totalFeeAmount: 0,
                totalPaidAmount: 0,
                totalDueAmount: 0,
                monthlyDues: 0,
                oneTimeDues: 0,
                pendingMonths: 0,
                status: "pending",
            };
        }
        const pendingMonthlyPayments = feeRecord.monthlyPayments.filter((p) => p.status !== "paid" && !p.waived);
        const monthlyDues = pendingMonthlyPayments.reduce((sum, p) => sum + (p.dueAmount - p.paidAmount), 0);
        const oneTimeDues = (feeRecord.oneTimeFees || [])
            .filter((f) => f.status === "pending" || f.status === "partial")
            .reduce((sum, f) => sum + (f.dueAmount - f.paidAmount), 0);
        const admissionFee = (feeRecord.oneTimeFees || []).find((f) => f.feeType === "admission");
        const monthlyPaid = feeRecord.monthlyPayments.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
        const oneTimePaid = (feeRecord.oneTimeFees || []).reduce((sum, f) => sum + (f.paidAmount || 0), 0);
        const calculatedTotalPaid = monthlyPaid + oneTimePaid;
        const calculatedTotalDue = feeRecord.totalFeeAmount - calculatedTotalPaid;
        const now = new Date();
        const upcomingPayments = feeRecord.monthlyPayments
            .filter((p) => p.status !== "paid" && !p.waived)
            .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
        const nextDue = upcomingPayments.length > 0 ? upcomingPayments[0] : null;
        const recentTransactions = await feeTransaction_model_1.default.find({
            student: student._id,
            school: schoolObjectId,
            transactionType: fee_interface_1.TransactionType.PAYMENT,
            status: "completed",
        })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();
        return {
            student: {
                _id: student._id,
                studentId: student.studentId,
                name: `${student.userId?.firstName || ""} ${student.userId?.lastName || ""}`.trim(),
                grade: student.grade,
                rollNumber: student.rollNumber,
                parentContact: student.userId?.phone || "",
            },
            hasFeeRecord: true,
            totalFeeAmount: feeRecord.totalFeeAmount,
            totalPaidAmount: calculatedTotalPaid,
            totalDueAmount: calculatedTotalDue,
            monthlyDues,
            oneTimeDues,
            pendingMonths: pendingMonthlyPayments.length,
            admissionPending: admissionFee && admissionFee.status !== "paid",
            admissionFeeAmount: admissionFee?.dueAmount || 0,
            admissionFeePaid: admissionFee?.paidAmount || 0,
            status: feeRecord.status,
            nextDue: nextDue
                ? {
                    month: nextDue.month,
                    amount: nextDue.dueAmount - nextDue.paidAmount,
                    dueDate: nextDue.dueDate,
                    isOverdue: new Date(nextDue.dueDate) < now,
                }
                : null,
            monthlyPayments: feeRecord.monthlyPayments,
            oneTimeFees: feeRecord.oneTimeFees || [],
            recentTransactions: recentTransactions.map((t) => ({
                _id: t._id,
                transactionId: t.transactionId,
                amount: t.amount,
                paymentMethod: t.paymentMethod,
                date: t.createdAt,
                month: t.month,
                remarks: t.remarks,
            })),
        };
    }
    async getParentChildrenFeeStatus(parentId, schoolId) {
        const schoolObjectId = new mongoose_1.Types.ObjectId(schoolId);
        const children = await Student.find({
            parentId: parentId,
            schoolId: schoolId,
            isActive: true,
        })
            .populate("userId", "firstName lastName email phone")
            .lean();
        if (children.length === 0) {
            return {
                children: [],
                totalDueAmount: 0,
                totalChildren: 0,
            };
        }
        const childrenWithFees = await Promise.all(children.map(async (child) => {
            const feeRecord = await studentFeeRecord_model_1.default.findOne({
                student: child._id,
                school: schoolObjectId,
                academicYear: this.getCurrentAcademicYear(),
            }).lean();
            if (!feeRecord) {
                return {
                    _id: child._id,
                    studentId: child.studentId,
                    name: `${child.userId?.firstName || ""} ${child.userId?.lastName || ""}`.trim(),
                    grade: child.grade,
                    section: child.section,
                    totalFees: 0,
                    totalPaid: 0,
                    totalDue: 0,
                    pendingMonths: 0,
                    admissionPending: false,
                    admissionFee: 0,
                    feeStatus: "pending",
                    hasFeeRecord: false,
                };
            }
            const pendingMonthlyPayments = feeRecord.monthlyPayments.filter((p) => p.status !== "paid" && !p.waived);
            const admissionFee = (feeRecord.oneTimeFees || []).find((f) => f.feeType === "admission");
            const upcomingPayments = feeRecord.monthlyPayments
                .filter((p) => p.status !== "paid" && !p.waived)
                .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
            const nextDue = upcomingPayments.length > 0 ? upcomingPayments[0] : null;
            return {
                _id: child._id,
                studentId: child.studentId,
                name: `${child.userId?.firstName || ""} ${child.userId?.lastName || ""}`.trim(),
                grade: child.grade,
                section: child.section,
                rollNumber: child.rollNumber,
                totalFees: feeRecord.totalFeeAmount,
                totalPaid: feeRecord.totalPaidAmount,
                totalDue: feeRecord.totalDueAmount,
                pendingMonths: pendingMonthlyPayments.length,
                admissionPending: admissionFee && admissionFee.status !== "paid",
                admissionFee: admissionFee?.dueAmount || 0,
                admissionFeePaid: admissionFee?.paidAmount || 0,
                admissionFeeRemaining: admissionFee
                    ? admissionFee.dueAmount - admissionFee.paidAmount
                    : 0,
                feeStatus: feeRecord.status,
                hasFeeRecord: true,
                nextDue: nextDue
                    ? {
                        month: nextDue.month,
                        amount: nextDue.dueAmount - nextDue.paidAmount,
                        dueDate: nextDue.dueDate,
                    }
                    : null,
            };
        }));
        const totalDueAmount = childrenWithFees.reduce((sum, child) => sum + child.totalDue, 0);
        return {
            children: childrenWithFees,
            totalDueAmount,
            totalChildren: children.length,
        };
    }
}
exports.default = new FeeCollectionService();
//# sourceMappingURL=feeCollection.service.js.map