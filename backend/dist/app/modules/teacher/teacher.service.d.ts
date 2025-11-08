import { ICreateTeacherRequest, IUpdateTeacherRequest, ITeacherResponse, ITeacherPhotoResponse, ITeacherStats } from "./teacher.interface";
declare class TeacherService {
    createTeacher(teacherData: ICreateTeacherRequest, files?: Express.Multer.File[]): Promise<ITeacherResponse>;
    getTeachers(queryParams: {
        page: number;
        limit: number;
        schoolId?: string;
        subject?: string;
        grade?: number;
        designation?: string;
        isActive?: string;
        isClassTeacher?: string;
        search?: string;
        sortBy: string;
        sortOrder: string;
    }): Promise<{
        teachers: ITeacherResponse[];
        totalCount: number;
        currentPage: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
    }>;
    getTeacherById(id: string): Promise<ITeacherResponse>;
    updateTeacher(id: string, updateData: IUpdateTeacherRequest): Promise<ITeacherResponse>;
    deleteTeacher(id: string): Promise<void>;
    uploadPhotos(teacherId: string, files: Express.Multer.File[]): Promise<ITeacherPhotoResponse[]>;
    deletePhoto(teacherId: string, photoId: string): Promise<void>;
    getTeachersBySubject(schoolId: string, subject: string): Promise<ITeacherResponse[]>;
    getTeacherStats(schoolId: string): Promise<ITeacherStats>;
    getTeacherPhotos(teacherId: string): Promise<ITeacherPhotoResponse[]>;
    getAvailablePhotoSlots(teacherId: string): Promise<number[]>;
    private formatTeacherResponse;
    getTeacherDashboard(userId: string): Promise<any>;
    getTeacherSchedule(userId: string): Promise<any>;
    private calculateDuration;
    getTeacherClasses(userId: string): Promise<any>;
    getCurrentPeriods(userId: string): Promise<any>;
    private canMarkAttendanceNow;
    private getPeriodTimeStatus;
    markAttendance(userId: string, attendanceData: {
        classId: string;
        subjectId: string;
        grade: number;
        section: string;
        date: string;
        period: number;
        students: Array<{
            studentId: string;
            status: "present" | "absent" | "late" | "excused";
        }>;
    }): Promise<any>;
    getStudentsForAttendance(userId: string, classId: string, subjectId: string, period: number): Promise<any>;
    getMyStudentsForAttendance(userId: string): Promise<any>;
    assignHomework(userId: string, homeworkData: any, attachments?: Express.Multer.File[]): Promise<any>;
    getMyHomeworkAssignments(userId: string, filters?: any): Promise<any>;
    issueWarning(userId: string, warningData: any): Promise<any>;
    issuePunishment(userId: string, punishmentData: any): Promise<any>;
    getMyDisciplinaryActions(userId: string, filters?: any): Promise<any>;
    resolveDisciplinaryAction(userId: string, actionId: string, resolutionNotes: string): Promise<any>;
    addDisciplinaryActionComment(userId: string, actionId: string, comment: string): Promise<any>;
    getStudentsByGrade(userId: string, grade: number, section?: string): Promise<any>;
    getMyGradingTasks(userId: string): Promise<any>;
    getExamGradingDetails(userId: string, examId: string, examItemId?: string): Promise<any>;
    submitGrades(userId: string, gradesData: any): Promise<any>;
}
export declare const teacherService: TeacherService;
export {};
//# sourceMappingURL=teacher.service.d.ts.map