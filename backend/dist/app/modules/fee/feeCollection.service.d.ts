import { Month, PaymentMethod, PaymentStatus } from "./fee.interface";
import { Types } from "mongoose";
declare class FeeCollectionService {
    searchStudent(studentId: string, schoolId: string): Promise<{
        _id: any;
        studentId: any;
        name: string;
        grade: any;
        rollNumber: any;
        parentContact: any;
    }>;
    getStudentFeeStatus(studentId: string, schoolId: string, academicYear?: string): Promise<{
        student: {
            _id: any;
            studentId: any;
            name: string;
            grade: any;
            rollNumber: any;
        };
        feeRecord: import("mongoose").Document<unknown, {}, import("./fee.interface").IStudentFeeRecord, {}, {}> & import("./fee.interface").IStudentFeeRecord & Required<{
            _id: Types.ObjectId;
        }> & {
            __v: number;
        };
        upcomingDue: {
            month: Month;
            amount: number;
            dueDate: Date;
        } | undefined;
        recentTransactions: (import("mongoose").Document<unknown, {}, import("./fee.interface").IFeeTransaction, {}, {}> & import("./fee.interface").IFeeTransaction & Required<{
            _id: Types.ObjectId;
        }> & {
            __v: number;
        })[];
    }>;
    validateFeeCollection(studentId: string, schoolId: string, month: Month, amount: number, includeLateFee?: boolean): Promise<{
        valid: boolean;
        warnings: string[];
        errors: string[];
        monthlyPayment: {
            month: Month;
            dueAmount: number;
            paidAmount: number;
            lateFee: number | undefined;
            status: PaymentStatus;
            dueDate: Date;
        };
        expectedAmount: number;
        monthlyExpectedAmount: number;
        totalOneTimeFeeAmount: number;
        lateFeeAmount: number;
        includeLateFee: boolean;
        isFirstPayment: boolean;
        pendingOneTimeFees: {
            feeType: any;
            amount: number;
        }[];
    }>;
    collectFee(data: {
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
    }): Promise<{
        success: boolean;
        transaction: import("mongoose").Document<unknown, {}, import("./fee.interface").IFeeTransaction, {}, {}> & import("./fee.interface").IFeeTransaction & Required<{
            _id: Types.ObjectId;
        }> & {
            __v: number;
        };
        oneTimeFeeTransactions: any[];
        feeRecord: import("mongoose").Document<unknown, {}, import("./fee.interface").IStudentFeeRecord, {}, {}> & import("./fee.interface").IStudentFeeRecord & Required<{
            _id: Types.ObjectId;
        }> & {
            __v: number;
        };
        warnings: string[];
        isFirstPayment: boolean;
        totalOneTimeFeeAmount: number;
    }>;
    getAccountantTransactions(accountantId: string, schoolId: string, startDate: Date, endDate: Date): Promise<{
        _id: any;
        transactionId: any;
        studentId: any;
        studentName: string;
        grade: any;
        section: any;
        amount: any;
        paymentMethod: any;
        date: any;
        month: any;
        status: any;
        remarks: any;
    }[]>;
    getDailyCollectionSummary(accountantId: string, schoolId: string, date: Date): Promise<{
        date: Date;
        totalCollected: any;
        totalTransactions: any;
        byPaymentMethod: any[];
    }>;
    getAccountantDashboard(accountantId: string, schoolId: string): Promise<{
        totalCollections: any;
        todayTransactions: any;
        monthlyTarget: number;
        monthlyTransactions: any;
        pendingDues: any;
        totalDefaulters: number;
        recentTransactions: {
            _id: any;
            transactionId: any;
            studentName: string;
            studentId: any;
            grade: any;
            section: any;
            amount: any;
            paymentMethod: any;
            date: any;
            month: any;
        }[];
        tuitionCollection: number;
        examCollection: number;
        transportCollection: number;
        otherCollection: number;
        monthlyBreakdown: any[];
    }>;
    getStudentsByGradeSection(schoolId: string, grade?: number, section?: string): Promise<{
        _id: any;
        studentId: any;
        name: string;
        grade: any;
        section: any;
        rollNumber: any;
        parentContact: any;
        feeStatus: {
            totalFeeAmount: number;
            totalPaidAmount: number;
            totalDueAmount: number;
            status: PaymentStatus;
            pendingMonths: number;
        } | null;
    }[]>;
    getDefaulters(schoolId: string): Promise<{
        _id: any;
        studentId: any;
        studentName: string;
        grade: any;
        section: any;
        rollNumber: any;
        parentContact: any;
        totalDueAmount: any;
        totalOverdue: any;
        overdueMonths: any;
        lastPaymentDate: any;
        feeStatus: any;
    }[]>;
    getFinancialReports(schoolId: string, reportType?: string, startDate?: string, endDate?: string): Promise<{
        reportType: string;
        period: {
            start: Date;
            end: Date;
        };
        summary: {
            totalAmount: any;
            totalTransactions: any;
            averageTransaction: number;
        };
        byPaymentMethod: any[];
        dailyBreakdown: any[];
        byGrade: any[];
        topAccountants: any[];
    }>;
    private getCurrentAcademicYear;
    private generateMonthlyPayments;
    collectOneTimeFee(data: {
        studentId: string;
        schoolId: string;
        feeType: string;
        amount: number;
        paymentMethod: PaymentMethod;
        collectedBy: string;
        remarks?: string;
        auditInfo?: {
            ipAddress?: string;
            deviceInfo?: string;
        };
    }): Promise<{
        success: boolean;
        transaction: import("mongoose").Document<unknown, {}, import("./fee.interface").IFeeTransaction, {}, {}> & import("./fee.interface").IFeeTransaction & Required<{
            _id: Types.ObjectId;
        }> & {
            __v: number;
        };
        feeRecord: import("mongoose").Document<unknown, {}, import("./fee.interface").IStudentFeeRecord, {}, {}> & import("./fee.interface").IStudentFeeRecord & Required<{
            _id: Types.ObjectId;
        }> & {
            __v: number;
        };
        oneTimeFee: {
            feeType: import("./fee.interface").FeeType;
            dueAmount: number;
            paidAmount: number;
            status: PaymentStatus;
            remainingAmount: number;
        };
    }>;
    getStudentFeeStatusDetailed(studentId: string, schoolId: string): Promise<{
        student: {
            _id: any;
            studentId: any;
            name: string;
            grade: any;
            rollNumber: any;
            parentContact?: undefined;
        };
        hasFeeRecord: boolean;
        totalFeeAmount: number;
        totalPaidAmount: number;
        totalDueAmount: number;
        monthlyDues: number;
        oneTimeDues: number;
        pendingMonths: number;
        status: string;
        admissionPending?: undefined;
        admissionFeeAmount?: undefined;
        admissionFeePaid?: undefined;
        nextDue?: undefined;
        monthlyPayments?: undefined;
        oneTimeFees?: undefined;
        recentTransactions?: undefined;
    } | {
        student: {
            _id: any;
            studentId: any;
            name: string;
            grade: any;
            rollNumber: any;
            parentContact: any;
        };
        hasFeeRecord: boolean;
        totalFeeAmount: any;
        totalPaidAmount: any;
        totalDueAmount: number;
        monthlyDues: any;
        oneTimeDues: any;
        pendingMonths: any;
        admissionPending: any;
        admissionFeeAmount: any;
        admissionFeePaid: any;
        status: any;
        nextDue: {
            month: any;
            amount: number;
            dueDate: any;
            isOverdue: boolean;
        } | null;
        monthlyPayments: any;
        oneTimeFees: any;
        recentTransactions: {
            _id: any;
            transactionId: any;
            amount: any;
            paymentMethod: any;
            date: any;
            month: any;
            remarks: any;
        }[];
    }>;
    getParentChildrenFeeStatus(parentId: string, schoolId: string): Promise<{
        children: ({
            _id: any;
            studentId: any;
            name: string;
            grade: any;
            section: any;
            totalFees: number;
            totalPaid: number;
            totalDue: number;
            pendingMonths: number;
            admissionPending: boolean;
            admissionFee: number;
            feeStatus: string;
            hasFeeRecord: boolean;
            rollNumber?: undefined;
            admissionFeePaid?: undefined;
            admissionFeeRemaining?: undefined;
            nextDue?: undefined;
        } | {
            _id: any;
            studentId: any;
            name: string;
            grade: any;
            section: any;
            rollNumber: any;
            totalFees: number;
            totalPaid: number;
            totalDue: number;
            pendingMonths: number;
            admissionPending: boolean | undefined;
            admissionFee: number;
            admissionFeePaid: number;
            admissionFeeRemaining: number;
            feeStatus: PaymentStatus;
            hasFeeRecord: boolean;
            nextDue: {
                month: Month;
                amount: number;
                dueDate: Date;
            } | null;
        })[];
        totalDueAmount: number;
        totalChildren: number;
    }>;
}
declare const _default: FeeCollectionService;
export default _default;
//# sourceMappingURL=feeCollection.service.d.ts.map