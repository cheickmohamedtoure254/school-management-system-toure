import { ICreateExamRequest, IUpdateExamRequest, ISubmitResultRequest, IExamResponse, IExamSchedule, IExamStats, IExamFilters } from "./exam.interface";
declare class ExamService {
    createExam(data: ICreateExamRequest, userId: string): Promise<IExamResponse>;
    getExamById(id: string, userId: string, userRole: string): Promise<IExamResponse>;
    updateExam(id: string, data: IUpdateExamRequest, userId: string): Promise<IExamResponse>;
    deleteExam(id: string, userId: string): Promise<void>;
    publishExam(id: string, userId: string): Promise<IExamResponse>;
    getExamsForTeacher(teacherId: string, filters?: IExamFilters): Promise<IExamResponse[]>;
    getExamsForStudent(studentId: string, filters?: IExamFilters): Promise<IExamResponse[]>;
    getExamsForClass(schoolId: string, grade: number, section?: string, filters?: IExamFilters): Promise<IExamResponse[]>;
    getExamSchedule(schoolId: string, grade: number, section?: string, startDate?: string, endDate?: string): Promise<IExamSchedule>;
    submitExamResults(data: ISubmitResultRequest, userId: string): Promise<any>;
    publishExamResults(id: string, userId: string): Promise<IExamResponse>;
    getExamResults(examId: string, userId: string, userRole: string): Promise<any[]>;
    getExamStatistics(examId: string, userId: string, userRole: string): Promise<IExamStats>;
    getUpcomingExams(schoolId: string, days?: number): Promise<IExamResponse[]>;
    getExamCalendar(schoolId: string, startDate: string, endDate: string): Promise<any>;
    private hasTimeConflict;
    private formatExamResponse;
}
export declare const examService: ExamService;
export {};
//# sourceMappingURL=exam.service.d.ts.map