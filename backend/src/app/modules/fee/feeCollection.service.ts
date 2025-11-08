import StudentFeeRecord from "./studentFeeRecord.model";
import FeeTransaction from "./feeTransaction.model";
import FeeStructure from "./feeStructure.model";
import { Month, PaymentMethod, TransactionType, PaymentStatus } from "./fee.interface";
import {AppError} from "../../errors/AppError";
import { model, Types } from "mongoose";

const Student = model("Student");

/**
 * Fee Collection Service
 * Handles fee collection operations by accountants
 */
class FeeCollectionService {
  /**
   * Search student by student ID
   */
  async searchStudent(studentId: string, schoolId: string) {
    const student = await Student.findOne({
      studentId,
      schoolId: schoolId,
    })
      .populate('userId', 'firstName lastName email phone')
      .select("studentId grade rollNumber userId");

    if (!student) {
      throw new AppError(404, "Student not found");
    }

    const userId = student.userId as any;
    const fullName = userId ? `${userId.firstName || ''} ${userId.lastName || ''}`.trim() : 'Unknown';

    return {
      _id: student._id,
      studentId: student.studentId,
      name: fullName,
      grade: student.grade,
      rollNumber: student.rollNumber,
      parentContact: userId?.phone || '',
    };
  }

  /**
   * Get student fee status
   */
  async getStudentFeeStatus(
    studentId: string,
    schoolId: string,
    academicYear?: string
  ) {
    // Find student by _id (not studentId string) and populate userId for name
    const student = await Student.findById(studentId)
      .populate('userId', 'firstName lastName email phone')
      .select("studentId grade rollNumber userId schoolId");

    if (!student) {
      throw new AppError(404, "Student not found");
    }

    // Verify student belongs to the accountant's school
    if (student.schoolId.toString() !== schoolId) {
      throw new AppError(403, "Access denied. Student belongs to a different school.");
    }

    const userId = student.userId as any;
    const studentName = userId ? `${userId.firstName || ''} ${userId.lastName || ''}`.trim() : 'Unknown';

    // Get current academic year if not provided
    const currentYear = academicYear || this.getCurrentAcademicYear();

    // Find the LATEST active fee structure for this grade
    const latestFeeStructure = await FeeStructure.findOne({
      school: schoolId,
      grade: student.grade,
      academicYear: currentYear,
      isActive: true,
    }).sort({ createdAt: -1 }); // Get the most recently created active structure

    if (!latestFeeStructure) {
      throw new AppError(
        404,
        `No fee structure has been set for Grade ${student.grade} in academic year ${currentYear}. Please ask the admin to create a fee structure for this grade first.`
      );
    }

    // Get or create fee record
    let feeRecord = await StudentFeeRecord.findOne({
      student: student._id,
      academicYear: currentYear,
    }).populate("feeStructure");

    // Check if fee record needs to be created or updated
    if (!feeRecord) {
      // Create new fee record
      const oneTimeFeeTotal = latestFeeStructure.feeComponents
        .filter((c: any) => c.isOneTime)
        .reduce((sum: number, c: any) => sum + c.amount, 0);
      const totalYearlyFee = (latestFeeStructure.totalAmount * 12) + oneTimeFeeTotal;

      feeRecord = await StudentFeeRecord.create({
        student: student._id,
        school: schoolId,
        grade: student.grade,
        academicYear: currentYear,
        feeStructure: latestFeeStructure._id,
        totalFeeAmount: totalYearlyFee,
        totalPaidAmount: 0,
        totalDueAmount: totalYearlyFee,
        monthlyPayments: this.generateMonthlyPayments(
          latestFeeStructure.totalAmount,
          latestFeeStructure.dueDate,
          currentYear
        ),
        oneTimeFees: latestFeeStructure.feeComponents
          .filter((c: any) => c.isOneTime)
          .map((c: any) => ({
            feeType: c.feeType,
            dueAmount: c.amount,
            paidAmount: 0,
            status: "pending",
          })),
        status: "pending",
      });
    } else {
      // Check if fee structure has been updated
      const currentStructureId = (feeRecord.feeStructure as any)?._id?.toString();
      const latestStructureId = latestFeeStructure._id.toString();

      if (currentStructureId !== latestStructureId) {
        // Fee structure has been updated! Auto-sync the record
        const oneTimeFeeTotal = latestFeeStructure.feeComponents
          .filter((c: any) => c.isOneTime)
          .reduce((sum: number, c: any) => sum + c.amount, 0);
        const totalYearlyFee = (latestFeeStructure.totalAmount * 12) + oneTimeFeeTotal;

        // Preserve paid amounts
        const totalPaid = feeRecord.totalPaidAmount;
        const newTotalDue = Math.max(0, totalYearlyFee - totalPaid);

        // Generate new monthly payments, preserving paid status
        const newMonthlyPayments = this.generateMonthlyPayments(
          latestFeeStructure.totalAmount,
          latestFeeStructure.dueDate,
          currentYear
        );

        const paidMonths = feeRecord.monthlyPayments
          .filter((p: any) => p.status === "paid")
          .map((p: any) => p.month);

        newMonthlyPayments.forEach((payment: any) => {
          if (paidMonths.includes(payment.month)) {
            payment.status = "paid";
            payment.paidAmount = payment.dueAmount;
          }
        });

        // Generate new one-time fees, preserving paid status
        const newOneTimeFees = latestFeeStructure.feeComponents
          .filter((c: any) => c.isOneTime)
          .map((c: any) => {
            const oldFee = feeRecord?.oneTimeFees?.find((f: any) => f.feeType === c.feeType);
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

        // Update the record with new structure
        await StudentFeeRecord.updateOne(
          { _id: feeRecord._id },
          {
            $set: {
              feeStructure: latestFeeStructure._id,
              totalFeeAmount: totalYearlyFee,
              totalDueAmount: newTotalDue,
              monthlyPayments: newMonthlyPayments,
              oneTimeFees: newOneTimeFees,
            },
          }
        );

        // Reload the updated record
        feeRecord = await StudentFeeRecord.findById(feeRecord._id).populate("feeStructure");
        
        if (!feeRecord) {
          throw new AppError(500, "Failed to reload updated fee record");
        }
      }
    }

    // Get upcoming due (first unpaid month)
    const now = new Date();
    const upcomingDue = feeRecord.monthlyPayments.find(
      (p: any) =>
        (p.status === "pending" || p.status === "overdue") &&
        !p.waived
    );

    // Get recent transactions
    const recentTransactions = await FeeTransaction.find({
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

  /**
   * Validate fee collection before processing
   */
  async validateFeeCollection(
    studentId: string,
    schoolId: string,
    month: Month,
    amount: number,
    includeLateFee: boolean = false
  ) {
    const status = await this.getStudentFeeStatus(studentId, schoolId);
    const monthlyPayment = status.feeRecord.monthlyPayments.find(
      (p: any) => p.month === month
    );

    if (!monthlyPayment) {
      throw new AppError(400, "Invalid month selected");
    }

    const warnings: string[] = [];
    const errors: string[] = [];

    // Check if already paid
    if (monthlyPayment.status === "paid") {
      errors.push("This month's fee is already fully paid");
    }

    // Check if waived
    if (monthlyPayment.waived) {
      errors.push("This month's fee has been waived");
    }

    // Check if this is the first payment - need to include one-time fees
    const isFirstPayment = status.feeRecord.totalPaidAmount === 0;
    const pendingOneTimeFees = status.feeRecord.oneTimeFees?.filter(
      (f: any) => f.status === "pending" || f.status === "partial"
    ) || [];

    let totalOneTimeFeeAmount = 0;
    if (isFirstPayment && pendingOneTimeFees.length > 0) {
      totalOneTimeFeeAmount = pendingOneTimeFees.reduce(
        (sum: number, f: any) => sum + (f.dueAmount - f.paidAmount),
        0
      );
      
      warnings.push(
        `First payment must include ₹${totalOneTimeFeeAmount} one-time fees (${pendingOneTimeFees.map((f: any) => f.feeType).join(", ")})`
      );
    }

    // Calculate late fee if applicable
    const lateFeeAmount = includeLateFee ? (monthlyPayment.lateFee || 0) : 0;
    
    // Check amount mismatch
    const monthlyExpectedAmount =
      monthlyPayment.dueAmount - monthlyPayment.paidAmount + lateFeeAmount;
    const totalExpectedAmount = monthlyExpectedAmount + totalOneTimeFeeAmount;

    if (amount > totalExpectedAmount) {
      warnings.push(
        `Amount exceeds due amount. Due: ₹${totalExpectedAmount} (Monthly: ₹${monthlyExpectedAmount}${totalOneTimeFeeAmount > 0 ? ` + One-time: ₹${totalOneTimeFeeAmount}` : ''}), Received: ₹${amount}`
      );
    }

    if (amount < totalExpectedAmount) {
      if (isFirstPayment && amount < totalOneTimeFeeAmount) {
        errors.push(
          `Insufficient amount. First payment must be at least ₹${totalOneTimeFeeAmount} to cover one-time fees. You can pay the monthly fee partially after that.`
        );
      } else {
        warnings.push(
          `Partial payment. Due: ₹${totalExpectedAmount}, Received: ₹${amount}, Remaining: ₹${totalExpectedAmount - amount}`
        );
      }
    }

    // Check for overdue
    const now = new Date();
    if (monthlyPayment.dueDate < now && monthlyPayment.status === "pending") {
      warnings.push(
        `Payment is overdue by ${Math.floor(
          (now.getTime() - monthlyPayment.dueDate.getTime()) / (1000 * 60 * 60 * 24)
        )} days`
      );
    }

    // Check for out-of-sequence payment
    const previousMonths = status.feeRecord.monthlyPayments.filter(
      (p: any) => p.month < month && p.status !== "paid" && !p.waived
    );

    if (previousMonths.length > 0) {
      warnings.push(
        `${previousMonths.length} previous month(s) are still pending`
      );
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
      pendingOneTimeFees: pendingOneTimeFees.map((f: any) => ({
        feeType: f.feeType,
        amount: f.dueAmount - f.paidAmount,
      })),
    };
  }

  /**
   * Collect fee payment
   */
  async collectFee(data: {
    studentId: string;
    schoolId: string;
    month: Month;
    amount: number;
    paymentMethod: PaymentMethod;
    collectedBy: string;
    remarks?: string;
    includeLateFee?: boolean;
    auditInfo?: {
      ipAddress?: string;
      deviceInfo?: string;
    };
  }) {
    // Validate first
    const validation = await this.validateFeeCollection(
      data.studentId,
      data.schoolId,
      data.month,
      data.amount,
      data.includeLateFee || false
    );

    if (!validation.valid) {
      throw new AppError(400, validation.errors.join("; "));
    }

    // Get student and fee record
    const status = await this.getStudentFeeStatus(data.studentId, data.schoolId);

    // Check if this is the first payment and there are pending one-time fees
    const isFirstPayment = status.feeRecord.totalPaidAmount === 0;
    const pendingOneTimeFees = status.feeRecord.oneTimeFees?.filter(
      (f: any) => f.status === "pending" || f.status === "partial"
    ) || [];

    let totalOneTimeFeeAmount = 0;
    if (isFirstPayment && pendingOneTimeFees.length > 0) {
      totalOneTimeFeeAmount = pendingOneTimeFees.reduce(
        (sum: number, f: any) => sum + (f.dueAmount - f.paidAmount),
        0
      );
    }

    const monthlyPaymentAmount = data.amount - totalOneTimeFeeAmount;
    
    if (monthlyPaymentAmount < 0) {
      throw new AppError(400, `Amount must be at least ₹${totalOneTimeFeeAmount} to cover one-time fees`);
    }

    // Record monthly payment in fee record
    if (monthlyPaymentAmount > 0) {
      await status.feeRecord.recordPayment(data.month, monthlyPaymentAmount);
    }

    // Record one-time fee payments if this is first payment
    const oneTimeFeeTransactions: any[] = [];
    if (isFirstPayment && totalOneTimeFeeAmount > 0) {
      for (const oneTimeFee of pendingOneTimeFees) {
        const amountToPay = oneTimeFee.dueAmount - oneTimeFee.paidAmount;
        oneTimeFee.paidAmount += amountToPay;
        oneTimeFee.paidDate = new Date();
        oneTimeFee.status = PaymentStatus.PAID;

        // Create separate transaction for one-time fee
        const oneTimeTxn = await FeeTransaction.create({
          transactionId: `TXN-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`,
          student: status.student._id,
          studentFeeRecord: status.feeRecord._id,
          school: data.schoolId,
          transactionType: TransactionType.PAYMENT,
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

      status.feeRecord.markModified('oneTimeFees');
      await status.feeRecord.save();
    }

    // Create transaction for monthly payment
    const transaction = await FeeTransaction.create({
      transactionId: `TXN-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`,
      student: status.student._id,
      studentFeeRecord: status.feeRecord._id,
      school: data.schoolId,
      transactionType: TransactionType.PAYMENT,
      amount: monthlyPaymentAmount > 0 ? monthlyPaymentAmount : data.amount,
      paymentMethod: data.paymentMethod,
      month: data.month,
      collectedBy: data.collectedBy,
      remarks: data.remarks || (isFirstPayment && totalOneTimeFeeAmount > 0 
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

  /**
   * Get accountant's transactions for a date
   */
  async getAccountantTransactions(
    accountantId: string,
    schoolId: string,
    startDate: Date,
    endDate: Date
  ) {
    const transactions = await FeeTransaction.find({
      school: schoolId,
      collectedBy: accountantId,
      createdAt: { $gte: startDate, $lte: endDate },
    })
      .populate({
        path: "student",
        select: "studentId grade section rollNumber userId",
        populate: {
          path: "userId",
          select: "firstName lastName email phone"
        }
      })
      .sort({ createdAt: -1 })
      .lean();

    // Map transactions to include studentName for frontend
    return transactions.map((t: any) => {
      const userId = t.student?.userId;
      const studentName = userId ? `${userId.firstName || ''} ${userId.lastName || ''}`.trim() : 'Unknown';
      
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

  /**
   * Get daily collection summary for accountant
   */
  async getDailyCollectionSummary(
    accountantId: string,
    schoolId: string,
    date: Date
  ) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const summary = await FeeTransaction.aggregate([
      {
        $match: {
          school: schoolId,
          collectedBy: accountantId,
          transactionType: TransactionType.PAYMENT,
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

  /**
   * Get accountant dashboard data
   */
  async getAccountantDashboard(accountantId: string, schoolId: string) {
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    // Start of current month
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

    // Convert schoolId to ObjectId
    const schoolObjectId = new Types.ObjectId(schoolId);

    // Today's collections
    const todayCollections = await FeeTransaction.aggregate([
      {
        $match: {
          school: schoolObjectId,
          transactionType: TransactionType.PAYMENT,
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

    // Month's collections
    const monthCollections = await FeeTransaction.aggregate([
      {
        $match: {
          school: schoolObjectId,
          transactionType: TransactionType.PAYMENT,
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

    // Pending dues across all students
    const pendingDues = await StudentFeeRecord.aggregate([
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

    // Defaulters count (students with overdue payments)
    const defaultersCount = await StudentFeeRecord.countDocuments({
      school: schoolObjectId,
      academicYear: this.getCurrentAcademicYear(),
      "monthlyPayments": {
        $elemMatch: {
          status: "overdue",
          waived: false,
        },
      },
    });

    // Recent transactions
    const recentTransactions = await FeeTransaction.find({
      school: schoolObjectId,
      transactionType: TransactionType.PAYMENT,
      status: "completed",
    })
      .populate({
        path: "student",
        select: "studentId grade section rollNumber userId",
        populate: {
          path: "userId",
          select: "firstName lastName email phone"
        }
      })
      .sort({ createdAt: -1 })
      .limit(10);

    // Monthly collection breakdown by fee type
    const monthlyBreakdown = await FeeTransaction.aggregate([
      {
        $match: {
          school: schoolId,
          transactionType: TransactionType.PAYMENT,
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

    // Get collection breakdown by fee type from monthlyPayments
    const feeTypeBreakdown = await StudentFeeRecord.aggregate([
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
                { $multiply: ["$monthlyPayments.paidAmount", { $divide: ["$structure.tuitionFee", { $add: ["$structure.tuitionFee", "$structure.computerFee", "$structure.examFee", "$structure.sportsFee", "$structure.libraryFee", "$structure.transportFee", "$structure.otherFees"] }] }] },
                0
              ] 
            } 
          },
          examFee: { 
            $sum: { 
              $cond: [
                { $gt: ["$structure.examFee", 0] }, 
                { $multiply: ["$monthlyPayments.paidAmount", { $divide: ["$structure.examFee", { $add: ["$structure.tuitionFee", "$structure.computerFee", "$structure.examFee", "$structure.sportsFee", "$structure.libraryFee", "$structure.transportFee", "$structure.otherFees"] }] }] },
                0
              ] 
            } 
          },
          transportFee: { 
            $sum: { 
              $cond: [
                { $gt: ["$structure.transportFee", 0] }, 
                { $multiply: ["$monthlyPayments.paidAmount", { $divide: ["$structure.transportFee", { $add: ["$structure.tuitionFee", "$structure.computerFee", "$structure.examFee", "$structure.sportsFee", "$structure.libraryFee", "$structure.transportFee", "$structure.otherFees"] }] }] },
                0
              ] 
            } 
          },
          otherFees: { 
            $sum: { 
              $cond: [
                { $gt: [{ $add: ["$structure.computerFee", "$structure.sportsFee", "$structure.libraryFee", "$structure.otherFees"] }, 0] }, 
                { $multiply: ["$monthlyPayments.paidAmount", { $divide: [{ $add: ["$structure.computerFee", "$structure.sportsFee", "$structure.libraryFee", "$structure.otherFees"] }, { $add: ["$structure.tuitionFee", "$structure.computerFee", "$structure.examFee", "$structure.sportsFee", "$structure.libraryFee", "$structure.transportFee", "$structure.otherFees"] }] }] },
                0
              ] 
            } 
          },
        },
      },
    ]);

    const breakdown = feeTypeBreakdown[0] || {};

    return {
      totalCollections: monthCollections[0]?.totalAmount || 0,
      todayTransactions: todayCollections[0]?.totalAmount || 0,
      monthlyTarget: (monthCollections[0]?.totalAmount || 0) * 1.2, // 20% above current for target
      monthlyTransactions: monthCollections[0]?.totalAmount || 0,
      pendingDues: pendingDues[0]?.totalDue || 0,
      totalDefaulters: defaultersCount,
      recentTransactions: recentTransactions.map((t: any) => {
        const userId = t.student?.userId;
        const studentName = userId ? `${userId.firstName || ''} ${userId.lastName || ''}`.trim() : "Unknown";
        
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

  /**
   * Get students by grade and section
   */
  async getStudentsByGradeSection(
    schoolId: string,
    grade?: number,
    section?: string
  ) {
    const query: any = { schoolId: schoolId, isActive: true };
    
    if (grade) query.grade = grade;
    if (section) query.section = section;

    const students = await Student.find(query)
      .populate('userId', 'firstName lastName email phone')
      .select("studentId grade section rollNumber userId")
      .sort({ grade: 1, section: 1, rollNumber: 1 })
      .lean();

    // Get fee status for each student
    const studentsWithFees = await Promise.all(
      students.map(async (student: any) => {
        const currentYear = this.getCurrentAcademicYear();
        let feeRecord = await StudentFeeRecord.findOne({
          student: student._id,
          academicYear: currentYear,
        });

        // If no fee record exists, try to create one if fee structure exists
        if (!feeRecord) {
          try {
            const latestFeeStructure = await FeeStructure.findOne({
              school: schoolId,
              grade: student.grade,
              academicYear: currentYear,
              isActive: true,
            }).sort({ createdAt: -1 });

            if (latestFeeStructure) {
              const oneTimeFeeTotal = latestFeeStructure.feeComponents
                .filter((c: any) => c.isOneTime)
                .reduce((sum: number, c: any) => sum + c.amount, 0);
              const totalYearlyFee = (latestFeeStructure.totalAmount * 12) + oneTimeFeeTotal;

              feeRecord = await StudentFeeRecord.create({
                student: student._id,
                school: schoolId,
                grade: student.grade,
                academicYear: currentYear,
                feeStructure: latestFeeStructure._id,
                totalFeeAmount: totalYearlyFee,
                totalPaidAmount: 0,
                totalDueAmount: totalYearlyFee,
                monthlyPayments: this.generateMonthlyPayments(
                  latestFeeStructure.totalAmount,
                  latestFeeStructure.dueDate,
                  currentYear
                ),
                oneTimeFees: latestFeeStructure.feeComponents
                  .filter((c: any) => c.isOneTime)
                  .map((c: any) => ({
                    feeType: c.feeType,
                    dueAmount: c.amount,
                    paidAmount: 0,
                    status: "pending",
                  })),
                status: "pending",
              });
            }
          } catch (error) {
            // Silent fail - student will show null fee status
          }
        }

        const userId = student.userId as any;
        const fullName = userId ? `${userId.firstName || ''} ${userId.lastName || ''}`.trim() : 'Unknown';

        // Calculate correct paid and due amounts on-the-fly
        let calculatedTotalPaid = 0;
        let calculatedTotalDue = 0;
        
        if (feeRecord) {
          // Calculate monthly paid
          const monthlyPaid = feeRecord.monthlyPayments.reduce(
            (sum: number, payment: any) => sum + (payment.paidAmount || 0),
            0
          );
          
          // Calculate one-time paid
          const oneTimePaid = (feeRecord.oneTimeFees || []).reduce(
            (sum: number, fee: any) => sum + (fee.paidAmount || 0),
            0
          );
          
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
          parentContact: userId?.phone || '',
          feeStatus: feeRecord ? {
            totalFeeAmount: feeRecord.totalFeeAmount,
            totalPaidAmount: calculatedTotalPaid,
            totalDueAmount: calculatedTotalDue,
            status: feeRecord.status,
            pendingMonths: feeRecord.monthlyPayments.filter(
              (p: any) => p.status === "pending" || p.status === "overdue"
            ).length,
          } : null,
        };
      })
    );

    return studentsWithFees;
  }

  /**
   * Get defaulters list
   */
  async getDefaulters(schoolId: string) {
    const currentYear = this.getCurrentAcademicYear();
    const schoolObjectId = new Types.ObjectId(schoolId);

    const defaulters = await StudentFeeRecord.find({
      school: schoolObjectId,
      academicYear: currentYear,
      "monthlyPayments": {
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
          select: "firstName lastName email phone"
        }
      })
      .sort({ totalDueAmount: -1 })
      .lean();

    return defaulters.map((record: any) => {
      const userId = record.student?.userId;
      const studentName = userId ? `${userId.firstName || ''} ${userId.lastName || ''}`.trim() : 'Unknown';
      
      const overdueMonths = record.monthlyPayments.filter(
        (p: any) => p.status === "overdue" && !p.waived
      );

      return {
        _id: record._id,
        studentId: record.student?.studentId,
        studentName,
        grade: record.student?.grade,
        section: record.student?.section,
        rollNumber: record.student?.rollNumber,
        parentContact: userId?.phone || '',
        totalDueAmount: record.totalDueAmount,
        totalOverdue: overdueMonths.reduce((sum: number, m: any) => sum + m.dueAmount, 0),
        overdueMonths: overdueMonths.length,
        lastPaymentDate: record.lastPaymentDate,
        feeStatus: record.status,
      };
    });
  }

  /**
   * Get financial reports (daily, weekly, monthly, yearly)
   */
  async getFinancialReports(
    schoolId: string,
    reportType: string = 'monthly',
    startDate?: string,
    endDate?: string
  ) {
    const schoolObjectId = new Types.ObjectId(schoolId);
    const now = new Date();
    let start: Date, end: Date;

    // Determine date range based on report type
    switch (reportType) {
      case 'daily':
        start = startDate ? new Date(startDate) : new Date(now);
        start.setHours(0, 0, 0, 0);
        end = endDate ? new Date(endDate) : new Date(now);
        end.setHours(23, 59, 59, 999);
        break;

      case 'weekly':
        start = startDate ? new Date(startDate) : new Date(now);
        start.setDate(start.getDate() - 7);
        start.setHours(0, 0, 0, 0);
        end = endDate ? new Date(endDate) : new Date(now);
        end.setHours(23, 59, 59, 999);
        break;

      case 'monthly':
        start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
        end = endDate ? new Date(endDate) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        break;

      case 'yearly':
        start = startDate ? new Date(startDate) : new Date(now.getFullYear(), 0, 1);
        end = endDate ? new Date(endDate) : new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
        break;

      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    // Total collections in period
    const totalCollections = await FeeTransaction.aggregate([
      {
        $match: {
          school: schoolObjectId,
          transactionType: TransactionType.PAYMENT,
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

    // Collections by payment method
    const byPaymentMethod = await FeeTransaction.aggregate([
      {
        $match: {
          school: schoolObjectId,
          transactionType: TransactionType.PAYMENT,
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

    // Daily breakdown for charts
    const dailyBreakdown = await FeeTransaction.aggregate([
      {
        $match: {
          school: schoolObjectId,
          transactionType: TransactionType.PAYMENT,
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

    // Collections by grade
    const byGrade = await FeeTransaction.aggregate([
      {
        $match: {
          school: schoolObjectId,
          transactionType: TransactionType.PAYMENT,
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

    // Top collecting accountants
    const topAccountants = await FeeTransaction.aggregate([
      {
        $match: {
          school: schoolObjectId,
          transactionType: TransactionType.PAYMENT,
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
        averageTransaction:
          totalCollections[0]?.count > 0
            ? totalCollections[0].totalAmount / totalCollections[0].count
            : 0,
      },
      byPaymentMethod,
      dailyBreakdown,
      byGrade,
      topAccountants,
    };
  }

  /**
   * Helper: Get current academic year
   */
  private getCurrentAcademicYear(): string {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Academic year starts in April (month 4)
    if (currentMonth >= 4) {
      return `${currentYear}-${currentYear + 1}`;
    } else {
      return `${currentYear - 1}-${currentYear}`;
    }
  }

  /**
   * Helper: Generate monthly payments array
   */
  private generateMonthlyPayments(
    monthlyAmount: number,
    dueDate: number = 10, // Default to 10th of month if not provided
    academicYear: string
  ) {
    const payments: any[] = [];
    const startYear = parseInt(academicYear.split("-")[0]);
    
    // Ensure dueDate is valid (1-31), default to 10 if invalid
    const validDueDate = (dueDate && dueDate >= 1 && dueDate <= 31) ? dueDate : 10;

    for (let i = 0; i < 12; i++) {
      const month = ((Month.APRIL + i - 1) % 12) + 1;
      const year = startYear + (month < Month.APRIL ? 1 : 0);

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

  /**
   * Collect one-time fee (admission, annual, etc.)
   */
  async collectOneTimeFee(data: {
    studentId: string;
    schoolId: string;
    feeType: string; // 'admission', 'annual', etc.
    amount: number;
    paymentMethod: PaymentMethod;
    collectedBy: string;
    remarks?: string;
    auditInfo?: {
      ipAddress?: string;
      deviceInfo?: string;
    };
  }) {
    const schoolObjectId = new Types.ObjectId(data.schoolId);
    
    // Get student and fee record
    const student = await Student.findOne({
      studentId: data.studentId,
      schoolId: data.schoolId,
    });

    if (!student) {
      throw new AppError(404, "Student not found");
    }

    const feeRecord = await StudentFeeRecord.findOne({
      student: student._id,
      school: schoolObjectId,
      academicYear: this.getCurrentAcademicYear(),
    });

    if (!feeRecord) {
      throw new AppError(404, "Student fee record not found");
    }

    // Find the one-time fee (use index to modify in place)
    const oneTimeFeeIndex = feeRecord.oneTimeFees?.findIndex(
      (fee: any) => fee.feeType === data.feeType && fee.status !== PaymentStatus.PAID
    );

    if (oneTimeFeeIndex === undefined || oneTimeFeeIndex === -1 || !feeRecord.oneTimeFees) {
      throw new AppError(
        404,
        `${data.feeType} fee not found or already paid`
      );
    }

    const oneTimeFee = feeRecord.oneTimeFees[oneTimeFeeIndex];

    // Validate amount
    const remainingAmount = oneTimeFee.dueAmount - oneTimeFee.paidAmount;
    if (data.amount > remainingAmount) {
      throw new AppError(
        400,
        `Payment amount (${data.amount}) exceeds remaining due amount (${remainingAmount})`
      );
    }

    // Update one-time fee directly on the array
    feeRecord.oneTimeFees[oneTimeFeeIndex].paidAmount = (feeRecord.oneTimeFees[oneTimeFeeIndex].paidAmount || 0) + data.amount;
    if (feeRecord.oneTimeFees[oneTimeFeeIndex].paidAmount >= feeRecord.oneTimeFees[oneTimeFeeIndex].dueAmount) {
      feeRecord.oneTimeFees[oneTimeFeeIndex].status = PaymentStatus.PAID;
      feeRecord.oneTimeFees[oneTimeFeeIndex].paidDate = new Date();
    } else {
      feeRecord.oneTimeFees[oneTimeFeeIndex].status = PaymentStatus.PARTIAL;
    }

    // Mark the array as modified for Mongoose
    feeRecord.markModified('oneTimeFees');

    // Update totals
    feeRecord.totalPaidAmount += data.amount;
    feeRecord.totalDueAmount -= data.amount;

    // Update overall status
    if (feeRecord.totalDueAmount === 0) {
      feeRecord.status = PaymentStatus.PAID;
    } else if (feeRecord.totalPaidAmount > 0) {
      feeRecord.status = PaymentStatus.PARTIAL;
    }

    await feeRecord.save();

    // Create transaction
    const transaction = await FeeTransaction.create({
      transactionId: `TXN-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`,
      student: student._id,
      studentFeeRecord: feeRecord._id,
      school: schoolObjectId,
      transactionType: TransactionType.PAYMENT,
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

  /**
   * Get student fee status with complete details
   */
  async getStudentFeeStatusDetailed(studentId: string, schoolId: string) {
    const schoolObjectId = new Types.ObjectId(schoolId);
    
    const student: any = await Student.findOne({
      studentId,
      schoolId: schoolId,
    })
      .populate('userId', 'firstName lastName email phone')
      .lean();

    if (!student) {
      throw new AppError(404, "Student not found");
    }

    const feeRecord: any = await StudentFeeRecord.findOne({
      student: student._id,
      school: schoolObjectId,
      academicYear: this.getCurrentAcademicYear(),
    })
      .populate('feeStructure')
      .lean();

    if (!feeRecord) {
      return {
        student: {
          _id: student._id,
          studentId: student.studentId,
          name: `${student.userId?.firstName || ''} ${student.userId?.lastName || ''}`.trim(),
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
        status: 'pending',
      };
    }

    // Calculate monthly dues
    const pendingMonthlyPayments = feeRecord.monthlyPayments.filter(
      (p: any) => p.status !== 'paid' && !p.waived
    );
    const monthlyDues = pendingMonthlyPayments.reduce(
      (sum: number, p: any) => sum + (p.dueAmount - p.paidAmount),
      0
    );

    // Calculate one-time dues (pending and partial only)
    const oneTimeDues = (feeRecord.oneTimeFees || [])
      .filter((f: any) => f.status === 'pending' || f.status === 'partial')
      .reduce((sum: number, f: any) => sum + (f.dueAmount - f.paidAmount), 0);

    // Check for pending admission fee
    const admissionFee = (feeRecord.oneTimeFees || []).find(
      (f: any) => f.feeType === 'admission'
    );

    // Calculate correct total paid amount (monthly + one-time)
    const monthlyPaid = feeRecord.monthlyPayments.reduce(
      (sum: number, p: any) => sum + (p.paidAmount || 0),
      0
    );
    const oneTimePaid = (feeRecord.oneTimeFees || []).reduce(
      (sum: number, f: any) => sum + (f.paidAmount || 0),
      0
    );
    const calculatedTotalPaid = monthlyPaid + oneTimePaid;
    const calculatedTotalDue = feeRecord.totalFeeAmount - calculatedTotalPaid;

    // Find next due payment
    const now = new Date();
    const upcomingPayments = feeRecord.monthlyPayments
      .filter((p: any) => p.status !== 'paid' && !p.waived)
      .sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

    const nextDue = upcomingPayments.length > 0 ? upcomingPayments[0] : null;

    // Recent transactions
    const recentTransactions = await FeeTransaction.find({
      student: student._id,
      school: schoolObjectId,
      transactionType: TransactionType.PAYMENT,
      status: "completed",
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    return {
      student: {
        _id: student._id,
        studentId: student.studentId,
        name: `${student.userId?.firstName || ''} ${student.userId?.lastName || ''}`.trim(),
        grade: student.grade,
        rollNumber: student.rollNumber,
        parentContact: student.userId?.phone || '',
      },
      hasFeeRecord: true,
      totalFeeAmount: feeRecord.totalFeeAmount,
      totalPaidAmount: calculatedTotalPaid,
      totalDueAmount: calculatedTotalDue,
      monthlyDues,
      oneTimeDues,
      pendingMonths: pendingMonthlyPayments.length,
      admissionPending: admissionFee && admissionFee.status !== 'paid',
      admissionFeeAmount: admissionFee?.dueAmount || 0,
      admissionFeePaid: admissionFee?.paidAmount || 0,
      status: feeRecord.status,
      nextDue: nextDue ? {
        month: nextDue.month,
        amount: nextDue.dueAmount - nextDue.paidAmount,
        dueDate: nextDue.dueDate,
        isOverdue: new Date(nextDue.dueDate) < now,
      } : null,
      monthlyPayments: feeRecord.monthlyPayments,
      oneTimeFees: feeRecord.oneTimeFees || [],
      recentTransactions: recentTransactions.map((t: any) => ({
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

  /**
   * Get parent's children fee status
   */
  async getParentChildrenFeeStatus(parentId: string, schoolId: string) {
    const schoolObjectId = new Types.ObjectId(schoolId);
    
    // Find all children of this parent
    const children = await Student.find({
      parentId: parentId,
      schoolId: schoolId,
      isActive: true,
    })
      .populate('userId', 'firstName lastName email phone')
      .lean();

    if (children.length === 0) {
      return {
        children: [],
        totalDueAmount: 0,
        totalChildren: 0,
      };
    }

    // Get fee status for each child
    const childrenWithFees = await Promise.all(
      children.map(async (child: any) => {
        const feeRecord = await StudentFeeRecord.findOne({
          student: child._id,
          school: schoolObjectId,
          academicYear: this.getCurrentAcademicYear(),
        }).lean();

        if (!feeRecord) {
          return {
            _id: child._id,
            studentId: child.studentId,
            name: `${child.userId?.firstName || ''} ${child.userId?.lastName || ''}`.trim(),
            grade: child.grade,
            section: child.section,
            totalFees: 0,
            totalPaid: 0,
            totalDue: 0,
            pendingMonths: 0,
            admissionPending: false,
            admissionFee: 0,
            feeStatus: 'pending',
            hasFeeRecord: false,
          };
        }

        // Calculate details
        const pendingMonthlyPayments = feeRecord.monthlyPayments.filter(
          (p: any) => p.status !== 'paid' && !p.waived
        );

        const admissionFee = (feeRecord.oneTimeFees || []).find(
          (f: any) => f.feeType === 'admission'
        );

        // Find next due
        const upcomingPayments = feeRecord.monthlyPayments
          .filter((p: any) => p.status !== 'paid' && !p.waived)
          .sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

        const nextDue = upcomingPayments.length > 0 ? upcomingPayments[0] : null;

        return {
          _id: child._id,
          studentId: child.studentId,
          name: `${child.userId?.firstName || ''} ${child.userId?.lastName || ''}`.trim(),
          grade: child.grade,
          section: child.section,
          rollNumber: child.rollNumber,
          totalFees: feeRecord.totalFeeAmount,
          totalPaid: feeRecord.totalPaidAmount,
          totalDue: feeRecord.totalDueAmount,
          pendingMonths: pendingMonthlyPayments.length,
          admissionPending: admissionFee && admissionFee.status !== 'paid',
          admissionFee: admissionFee?.dueAmount || 0,
          admissionFeePaid: admissionFee?.paidAmount || 0,
          admissionFeeRemaining: admissionFee ? (admissionFee.dueAmount - admissionFee.paidAmount) : 0,
          feeStatus: feeRecord.status,
          hasFeeRecord: true,
          nextDue: nextDue ? {
            month: nextDue.month,
            amount: nextDue.dueAmount - nextDue.paidAmount,
            dueDate: nextDue.dueDate,
          } : null,
        };
      })
    );

    // Calculate total due for all children
    const totalDueAmount = childrenWithFees.reduce(
      (sum, child) => sum + child.totalDue,
      0
    );

    return {
      children: childrenWithFees,
      totalDueAmount,
      totalChildren: children.length,
    };
  }
}

export default new FeeCollectionService();
