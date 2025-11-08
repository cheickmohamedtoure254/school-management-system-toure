import { Types } from 'mongoose';
import { Exam, ExamResult } from './exam.model';
import {
  ICreateExamRequest,
  IUpdateExamRequest,
  ISubmitResultRequest,
  IExamResponse,
  IExamSchedule,
  IExamStats,
  IExamFilters,
  IExamDocument,
  IExamResultDocument,
} from './exam.interface';
import { AppError } from '../../errors/AppError';
import { Student } from '../student/student.model';
import { Teacher } from '../teacher/teacher.model';
import { Subject } from '../subject/subject.model';
import { School } from '../school/school.model';

class ExamService {
  // Create exam
  async createExam(data: ICreateExamRequest, userId: string): Promise<IExamResponse> {
    // Verify teacher has permission to create exam for this school
    const teacher = await Teacher.findById(data.teacherId).populate('schoolId');
    if (!teacher) {
      throw new AppError(404, 'Teacher not found');
    }

    // Verify subject exists
    const subject = await Subject.findById(data.subjectId);
    if (!subject) {
      throw new AppError(404, 'Subject not found');
    }

    // Check for conflicting exams (same grade, section, subject, date, overlapping time)
    const examDate = new Date(data.examDate);
    const conflictingExams = await Exam.find({
      schoolId: data.schoolId,
      grade: data.grade,
      section: data.section,
      subjectId: data.subjectId,
      examDate: {
        $gte: new Date(examDate.getFullYear(), examDate.getMonth(), examDate.getDate()),
        $lt: new Date(examDate.getFullYear(), examDate.getMonth(), examDate.getDate() + 1),
      },
      isActive: true,
    });

    // Check for time conflicts
    for (const existingExam of conflictingExams) {
      if (this.hasTimeConflict(data.startTime, data.endTime, existingExam.startTime, existingExam.endTime)) {
        throw new AppError(400, `Time conflict with existing exam: ${existingExam.examName}`);
      }
    }

    // Create exam
    const examData = {
      ...data,
      schoolId: new Types.ObjectId(data.schoolId),
      teacherId: new Types.ObjectId(data.teacherId),
      subjectId: new Types.ObjectId(data.subjectId),
      examDate: new Date(data.examDate),
      createdBy: new Types.ObjectId(userId),
      isPublished: false,
      resultsPublished: false,
      isActive: true,
    };

    const exam = await Exam.create(examData);
    return this.formatExamResponse(exam);
  }

  // Get exam by ID
  async getExamById(id: string, userId: string, userRole: string): Promise<IExamResponse> {
    const exam = await Exam.findById(id)
      .populate('teacherId', 'userId teacherId')
      .populate('subjectId', 'name code')
      .populate('schoolId', 'name')
      .populate('createdBy', 'firstName lastName');

    if (!exam) {
      throw new AppError(404, 'Exam not found');
    }

    // Check permissions based on role
    if (userRole === 'teacher') {
      const teacher = await Teacher.findOne({ userId });
      if (!teacher || exam.teacherId.toString() !== teacher._id.toString()) {
        throw new AppError(403, 'Not authorized to view this exam');
      }
    } else if (userRole === 'student') {
      const student = await Student.findOne({ userId });
      if (!student || exam.schoolId.toString() !== student.schoolId.toString() ||
          exam.grade !== student.grade || 
          (exam.section && exam.section !== student.section)) {
        throw new AppError(403, 'Not authorized to view this exam');
      }
    }

    const formattedExam = this.formatExamResponse(exam);

    // Add student and submission counts for authorized users
    if (['teacher', 'admin', 'superadmin'].includes(userRole)) {
      const eligibleStudents = await exam.getEligibleStudents();
      const submissionCount = await ExamResult.countDocuments({ examId: exam._id });
      formattedExam.studentCount = eligibleStudents.length;
      formattedExam.submissionCount = submissionCount;
    }

    return formattedExam;
  }

  // Update exam
  async updateExam(id: string, data: IUpdateExamRequest, userId: string): Promise<IExamResponse> {
    const exam = await Exam.findById(id);
    if (!exam) {
      throw new AppError(404, 'Exam not found');
    }

    // Verify teacher owns this exam or is admin
    const teacher = await Teacher.findOne({ userId });
    if (!teacher || exam.teacherId.toString() !== teacher._id.toString()) {
      throw new AppError(403, 'Not authorized to update this exam');
    }

    // Don't allow updating critical fields if results exist
    if (exam.resultsPublished) {
      const restrictedFields = ['totalMarks', 'passingMarks', 'examDate', 'startTime', 'endTime'];
      const hasRestrictedChanges = restrictedFields.some(field => data[field as keyof IUpdateExamRequest] !== undefined);
      
      if (hasRestrictedChanges) {
        throw new AppError(400, 'Cannot update critical fields when results are published');
      }
    }

    // Check for time conflicts if date/time is being updated
    if (data.examDate || data.startTime || data.endTime) {
      const examDate = data.examDate ? new Date(data.examDate) : exam.examDate;
      const startTime = data.startTime || exam.startTime;
      const endTime = data.endTime || exam.endTime;

      const conflictingExams = await Exam.find({
        _id: { $ne: id },
        schoolId: exam.schoolId,
        grade: exam.grade,
        section: exam.section,
        subjectId: exam.subjectId,
        examDate: {
          $gte: new Date(examDate.getFullYear(), examDate.getMonth(), examDate.getDate()),
          $lt: new Date(examDate.getFullYear(), examDate.getMonth(), examDate.getDate() + 1),
        },
        isActive: true,
      });

      for (const existingExam of conflictingExams) {
        if (this.hasTimeConflict(startTime, endTime, existingExam.startTime, existingExam.endTime)) {
          throw new AppError(400, `Time conflict with existing exam: ${existingExam.examName}`);
        }
      }
    }

    // Update exam
    const updateData = { ...data };
    if (data.examDate) {
      updateData.examDate = new Date(data.examDate) as any;
    }

    const updatedExam = await Exam.findByIdAndUpdate(id, updateData, { new: true })
      .populate('teacherId', 'userId teacherId')
      .populate('subjectId', 'name code')
      .populate('schoolId', 'name')
      .populate('createdBy', 'firstName lastName');

    if (!updatedExam) {
      throw new AppError(404, 'Exam not found after update');
    }

    return this.formatExamResponse(updatedExam);
  }

  // Delete exam
  async deleteExam(id: string, userId: string): Promise<void> {
    const exam = await Exam.findById(id);
    if (!exam) {
      throw new AppError(404, 'Exam not found');
    }

    // Verify teacher owns this exam or is admin
    const teacher = await Teacher.findOne({ userId });
    if (!teacher || exam.teacherId.toString() !== teacher._id.toString()) {
      throw new AppError(403, 'Not authorized to delete this exam');
    }

    // Check if results exist
    const resultCount = await ExamResult.countDocuments({ examId: id });
    if (resultCount > 0) {
      throw new AppError(400, 'Cannot delete exam with existing results');
    }

    // Soft delete
    await Exam.findByIdAndUpdate(id, { isActive: false });
  }

  // Publish exam
  async publishExam(id: string, userId: string): Promise<IExamResponse> {
    const exam = await Exam.findById(id);
    if (!exam) {
      throw new AppError(404, 'Exam not found');
    }

    // Verify teacher owns this exam or is admin
    const teacher = await Teacher.findOne({ userId });
    if (!teacher || exam.teacherId.toString() !== teacher._id.toString()) {
      throw new AppError(403, 'Not authorized to publish this exam');
    }

    exam.isPublished = true;
    await exam.save();

    const updatedExam = await Exam.findById(id)
      .populate('teacherId', 'userId teacherId')
      .populate('subjectId', 'name code')
      .populate('schoolId', 'name')
      .populate('createdBy', 'firstName lastName');

    return this.formatExamResponse(updatedExam!);
  }

  // Get exams for teacher
  async getExamsForTeacher(teacherId: string, filters?: IExamFilters): Promise<IExamResponse[]> {
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      throw new AppError(404, 'Teacher not found');
    }

    const exams = await Exam.findByTeacher(teacherId);
    return exams.map(exam => this.formatExamResponse(exam));
  }

  // Get exams for student
  async getExamsForStudent(studentId: string, filters?: IExamFilters): Promise<IExamResponse[]> {
    const student = await Student.findById(studentId);
    if (!student) {
      throw new AppError(404, 'Student not found');
    }

    const exams = await Exam.findByClass(student.schoolId.toString(), student.grade, student.section);
    
    // Filter only published exams for students
    const publishedExams = exams.filter(exam => exam.isPublished);
    
    return publishedExams.map(exam => this.formatExamResponse(exam));
  }

  // Get exams for class
  async getExamsForClass(
    schoolId: string,
    grade: number,
    section?: string,
    filters?: IExamFilters
  ): Promise<IExamResponse[]> {
    const exams = await Exam.findByClass(schoolId, grade, section);
    return exams.map(exam => this.formatExamResponse(exam));
  }

  // Get exam schedule
  async getExamSchedule(
    schoolId: string,
    grade: number,
    section?: string,
    startDate?: string,
    endDate?: string
  ): Promise<IExamSchedule> {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    return await Exam.getExamSchedule(schoolId, grade, section, start, end);
  }

  // Submit exam results
  async submitExamResults(data: ISubmitResultRequest, userId: string): Promise<any> {
    // Verify exam exists
    const exam = await Exam.findById(data.examId);
    if (!exam) {
      throw new AppError(404, 'Exam not found');
    }

    // Verify teacher can submit results for this exam
    const teacher = await Teacher.findOne({ userId });
    if (!teacher || exam.teacherId.toString() !== teacher._id.toString()) {
      throw new AppError(403, 'Not authorized to submit results for this exam');
    }

    // Verify all students are eligible for this exam
    const eligibleStudents = await exam.getEligibleStudents();
    const eligibleStudentIds = eligibleStudents.map(s => s._id.toString());

    const invalidStudents = data.results.filter(
      result => !eligibleStudentIds.includes(result.studentId)
    );

    if (invalidStudents.length > 0) {
      throw new AppError(400, 'Some students are not eligible for this exam');
    }

    // Validate marks against total marks
    const invalidMarks = data.results.filter(
      result => !result.isAbsent && 
                result.marksObtained !== undefined && 
                result.marksObtained > exam.totalMarks
    );

    if (invalidMarks.length > 0) {
      throw new AppError(400, 'Some marks exceed the total marks for this exam');
    }

    // Process results
    const results: any[] = [];
    for (const resultData of data.results) {
      // Check if result already exists
      let existingResult = await ExamResult.findOne({
        examId: exam._id,
        studentId: resultData.studentId,
      });

      const resultInfo = {
        examId: exam._id,
        studentId: new Types.ObjectId(resultData.studentId),
        marksObtained: resultData.isAbsent ? 0 : resultData.marksObtained || 0,
        isAbsent: resultData.isAbsent || false,
        remarks: resultData.remarks,
        checkedBy: new Types.ObjectId(userId),
        checkedAt: new Date(),
      };

      if (existingResult) {
        // Update existing result
        Object.assign(existingResult, resultInfo);
        await existingResult.save();
        results.push(existingResult);
      } else {
        // Create new result
        const newResult = await ExamResult.create(resultInfo);
        results.push(newResult);
      }
    }

    return {
      examId: data.examId,
      totalResults: results.length,
      submittedAt: new Date(),
      submittedBy: userId,
    };
  }

  // Publish exam results
  async publishExamResults(id: string, userId: string): Promise<IExamResponse> {
    const exam = await Exam.findById(id);
    if (!exam) {
      throw new AppError(404, 'Exam not found');
    }

    // Verify teacher owns this exam or is admin
    const teacher = await Teacher.findOne({ userId });
    if (!teacher || exam.teacherId.toString() !== teacher._id.toString()) {
      throw new AppError(403, 'Not authorized to publish results for this exam');
    }

    // Check if exam is completed
    if (!exam.isCompleted()) {
      throw new AppError(400, 'Cannot publish results for ongoing or future exam');
    }

    // Check if results exist
    const resultCount = await ExamResult.countDocuments({ examId: id });
    if (resultCount === 0) {
      throw new AppError(400, 'No results found to publish');
    }

    exam.resultsPublished = true;
    await exam.save();

    const updatedExam = await Exam.findById(id)
      .populate('teacherId', 'userId teacherId')
      .populate('subjectId', 'name code')
      .populate('schoolId', 'name')
      .populate('createdBy', 'firstName lastName');

    return this.formatExamResponse(updatedExam!);
  }

  // Get exam results
  async getExamResults(examId: string, userId: string, userRole: string): Promise<any[]> {
    const exam = await Exam.findById(examId);
    if (!exam) {
      throw new AppError(404, 'Exam not found');
    }

    // Check permissions
    if (userRole === 'teacher') {
      const teacher = await Teacher.findOne({ userId });
      if (!teacher || exam.teacherId.toString() !== teacher._id.toString()) {
        throw new AppError(403, 'Not authorized to view results for this exam');
      }
    } else if (userRole === 'student') {
      // Students can only view their own results and only if published
      if (!exam.resultsPublished) {
        throw new AppError(403, 'Results not yet published');
      }
    }

    const results = await ExamResult.find({ examId })
      .populate({
        path: 'studentId',
        select: 'userId rollNumber',
        populate: {
          path: 'userId',
          select: 'firstName lastName'
        }
      })
      .sort({ marksObtained: -1 });

    // For students, return only their result
    if (userRole === 'student') {
      const student = await Student.findOne({ userId });
      if (!student) {
        throw new AppError(404, 'Student not found');
      }

      const studentResult = results.find(
        result => result.studentId._id.toString() === student._id.toString()
      );

      return studentResult ? [studentResult] : [];
    }

    return results;
  }

  // Get exam statistics
  async getExamStatistics(examId: string, userId: string, userRole: string): Promise<IExamStats> {
    const exam = await Exam.findById(examId);
    if (!exam) {
      throw new AppError(404, 'Exam not found');
    }

    // Check permissions
    if (userRole === 'teacher') {
      const teacher = await Teacher.findOne({ userId });
      if (!teacher || exam.teacherId.toString() !== teacher._id.toString()) {
        throw new AppError(403, 'Not authorized to view statistics for this exam');
      }
    }

    return await Exam.getExamStats(exam.schoolId.toString(), examId);
  }

  // Get upcoming exams
  async getUpcomingExams(schoolId: string, days: number = 30): Promise<IExamResponse[]> {
    const exams = await Exam.findUpcoming(schoolId, days);
    return exams.map(exam => this.formatExamResponse(exam));
  }

  // Get exam calendar for academic calendar integration
  async getExamCalendar(schoolId: string, startDate: string, endDate: string): Promise<any> {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const exams = await Exam.findByDateRange(schoolId, start, end);

    // Group exams by date for calendar view
    const examsByDate: { [key: string]: IExamResponse[] } = {};
    
    exams.forEach(exam => {
      const dateKey = exam.examDate.toISOString().split('T')[0];
      if (!examsByDate[dateKey]) {
        examsByDate[dateKey] = [];
      }
      examsByDate[dateKey].push(this.formatExamResponse(exam));
    });

    // Convert to calendar format
    const calendarData = Object.entries(examsByDate).map(([date, examList]) => ({
      date: new Date(date),
      exams: examList,
    }));

    return {
      startDate: start,
      endDate: end,
      exams: calendarData,
      summary: {
        totalExams: exams.length,
        upcomingExams: exams.filter(exam => exam.isUpcoming()).length,
        ongoingExams: exams.filter(exam => exam.isOngoing()).length,
        completedExams: exams.filter(exam => exam.isCompleted()).length,
        publishedExams: exams.filter(exam => exam.isPublished).length,
      },
    };
  }

  // Helper method to check time conflicts
  private hasTimeConflict(
    startTime1: string,
    endTime1: string,
    startTime2: string,
    endTime2: string
  ): boolean {
    const [start1Hours, start1Minutes] = startTime1.split(':').map(Number);
    const [end1Hours, end1Minutes] = endTime1.split(':').map(Number);
    const [start2Hours, start2Minutes] = startTime2.split(':').map(Number);
    const [end2Hours, end2Minutes] = endTime2.split(':').map(Number);

    const start1TotalMinutes = start1Hours * 60 + start1Minutes;
    const end1TotalMinutes = end1Hours * 60 + end1Minutes;
    const start2TotalMinutes = start2Hours * 60 + start2Minutes;
    const end2TotalMinutes = end2Hours * 60 + end2Minutes;

    // Check for overlap
    return !(end1TotalMinutes <= start2TotalMinutes || end2TotalMinutes <= start1TotalMinutes);
  }

  // Helper method to format exam response
  private formatExamResponse(exam: IExamDocument): IExamResponse {
    const formatted = exam.toJSON() as any;
    
    // Add populated data if available
    if (exam.schoolId && typeof exam.schoolId === 'object') {
      formatted.school = {
        id: exam.schoolId._id.toString(),
        name: (exam.schoolId as any).name,
      };
    }

    if (exam.teacherId && typeof exam.teacherId === 'object') {
      const teacher = exam.teacherId as any;
      formatted.teacher = {
        id: teacher._id.toString(),
        userId: teacher.userId?.toString(),
        teacherId: teacher.teacherId,
        fullName: teacher.userId ? `${teacher.userId.firstName} ${teacher.userId.lastName}` : 'Unknown Teacher',
      };
    }

    if (exam.subjectId && typeof exam.subjectId === 'object') {
      const subject = exam.subjectId as any;
      formatted.subject = {
        id: subject._id.toString(),
        name: subject.name,
        code: subject.code,
      };
    }

    if (exam.createdBy && typeof exam.createdBy === 'object') {
      const creator = exam.createdBy as any;
      formatted.createdBy = {
        id: creator._id.toString(),
        fullName: `${creator.firstName} ${creator.lastName}`,
      };
    }

    return formatted;
  }
}

export const examService = new ExamService();