"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.examService = void 0;
const mongoose_1 = require("mongoose");
const exam_model_1 = require("./exam.model");
const AppError_1 = require("../../errors/AppError");
const student_model_1 = require("../student/student.model");
const teacher_model_1 = require("../teacher/teacher.model");
const subject_model_1 = require("../subject/subject.model");
class ExamService {
    async createExam(data, userId) {
        const teacher = await teacher_model_1.Teacher.findById(data.teacherId).populate("schoolId");
        if (!teacher) {
            throw new AppError_1.AppError(404, "Teacher not found");
        }
        const subject = await subject_model_1.Subject.findById(data.subjectId);
        if (!subject) {
            throw new AppError_1.AppError(404, "Subject not found");
        }
        const examDate = new Date(data.examDate);
        const conflictingExams = await exam_model_1.Exam.find({
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
        for (const existingExam of conflictingExams) {
            if (this.hasTimeConflict(data.startTime, data.endTime, existingExam.startTime, existingExam.endTime)) {
                throw new AppError_1.AppError(400, `Time conflict with existing exam: ${existingExam.examName}`);
            }
        }
        const examData = {
            ...data,
            schoolId: new mongoose_1.Types.ObjectId(data.schoolId),
            teacherId: new mongoose_1.Types.ObjectId(data.teacherId),
            subjectId: new mongoose_1.Types.ObjectId(data.subjectId),
            examDate: new Date(data.examDate),
            createdBy: new mongoose_1.Types.ObjectId(userId),
            isPublished: false,
            resultsPublished: false,
            isActive: true,
        };
        const exam = await exam_model_1.Exam.create(examData);
        return this.formatExamResponse(exam);
    }
    async getExamById(id, userId, userRole) {
        const exam = await exam_model_1.Exam.findById(id)
            .populate("teacherId", "userId teacherId")
            .populate("subjectId", "name code")
            .populate("schoolId", "name")
            .populate("createdBy", "firstName lastName");
        if (!exam) {
            throw new AppError_1.AppError(404, "Exam not found");
        }
        if (userRole === "teacher") {
            const teacher = await teacher_model_1.Teacher.findOne({ userId });
            if (!teacher || exam.teacherId.toString() !== teacher._id.toString()) {
                throw new AppError_1.AppError(403, "Not authorized to view this exam");
            }
        }
        else if (userRole === "student") {
            const student = await student_model_1.Student.findOne({ userId });
            if (!student ||
                exam.schoolId.toString() !== student.schoolId.toString() ||
                exam.grade !== student.grade ||
                (exam.section && exam.section !== student.section)) {
                throw new AppError_1.AppError(403, "Not authorized to view this exam");
            }
        }
        const formattedExam = this.formatExamResponse(exam);
        if (["teacher", "admin", "superadmin"].includes(userRole)) {
            const eligibleStudents = await exam.getEligibleStudents();
            const submissionCount = await exam_model_1.ExamResult.countDocuments({
                examId: exam._id,
            });
            formattedExam.studentCount = eligibleStudents.length;
            formattedExam.submissionCount = submissionCount;
        }
        return formattedExam;
    }
    async updateExam(id, data, userId) {
        const exam = await exam_model_1.Exam.findById(id);
        if (!exam) {
            throw new AppError_1.AppError(404, "Exam not found");
        }
        const teacher = await teacher_model_1.Teacher.findOne({ userId });
        if (!teacher || exam.teacherId.toString() !== teacher._id.toString()) {
            throw new AppError_1.AppError(403, "Not authorized to update this exam");
        }
        if (exam.resultsPublished) {
            const restrictedFields = [
                "totalMarks",
                "passingMarks",
                "examDate",
                "startTime",
                "endTime",
            ];
            const hasRestrictedChanges = restrictedFields.some((field) => data[field] !== undefined);
            if (hasRestrictedChanges) {
                throw new AppError_1.AppError(400, "Cannot update critical fields when results are published");
            }
        }
        if (data.examDate || data.startTime || data.endTime) {
            const examDate = data.examDate ? new Date(data.examDate) : exam.examDate;
            const startTime = data.startTime || exam.startTime;
            const endTime = data.endTime || exam.endTime;
            const conflictingExams = await exam_model_1.Exam.find({
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
                    throw new AppError_1.AppError(400, `Time conflict with existing exam: ${existingExam.examName}`);
                }
            }
        }
        const updateData = { ...data };
        if (data.examDate) {
            updateData.examDate = new Date(data.examDate);
        }
        const updatedExam = await exam_model_1.Exam.findByIdAndUpdate(id, updateData, {
            new: true,
        })
            .populate("teacherId", "userId teacherId")
            .populate("subjectId", "name code")
            .populate("schoolId", "name")
            .populate("createdBy", "firstName lastName");
        if (!updatedExam) {
            throw new AppError_1.AppError(404, "Exam not found after update");
        }
        return this.formatExamResponse(updatedExam);
    }
    async deleteExam(id, userId) {
        const exam = await exam_model_1.Exam.findById(id);
        if (!exam) {
            throw new AppError_1.AppError(404, "Exam not found");
        }
        const teacher = await teacher_model_1.Teacher.findOne({ userId });
        if (!teacher || exam.teacherId.toString() !== teacher._id.toString()) {
            throw new AppError_1.AppError(403, "Not authorized to delete this exam");
        }
        const resultCount = await exam_model_1.ExamResult.countDocuments({ examId: id });
        if (resultCount > 0) {
            throw new AppError_1.AppError(400, "Cannot delete exam with existing results");
        }
        await exam_model_1.Exam.findByIdAndUpdate(id, { isActive: false });
    }
    async publishExam(id, userId) {
        const exam = await exam_model_1.Exam.findById(id);
        if (!exam) {
            throw new AppError_1.AppError(404, "Exam not found");
        }
        const teacher = await teacher_model_1.Teacher.findOne({ userId });
        if (!teacher || exam.teacherId.toString() !== teacher._id.toString()) {
            throw new AppError_1.AppError(403, "Not authorized to publish this exam");
        }
        exam.isPublished = true;
        await exam.save();
        const updatedExam = await exam_model_1.Exam.findById(id)
            .populate("teacherId", "userId teacherId")
            .populate("subjectId", "name code")
            .populate("schoolId", "name")
            .populate("createdBy", "firstName lastName");
        return this.formatExamResponse(updatedExam);
    }
    async getExamsForTeacher(teacherId, filters) {
        const teacher = await teacher_model_1.Teacher.findById(teacherId);
        if (!teacher) {
            throw new AppError_1.AppError(404, "Teacher not found");
        }
        const exams = await exam_model_1.Exam.findByTeacher(teacherId);
        return exams.map((exam) => this.formatExamResponse(exam));
    }
    async getExamsForStudent(studentId, filters) {
        const student = await student_model_1.Student.findById(studentId);
        if (!student) {
            throw new AppError_1.AppError(404, "Student not found");
        }
        const exams = await exam_model_1.Exam.findByClass(student.schoolId.toString(), student.grade, student.section);
        const publishedExams = exams.filter((exam) => exam.isPublished);
        return publishedExams.map((exam) => this.formatExamResponse(exam));
    }
    async getExamsForClass(schoolId, grade, section, filters) {
        const exams = await exam_model_1.Exam.findByClass(schoolId, grade, section);
        return exams.map((exam) => this.formatExamResponse(exam));
    }
    async getExamSchedule(schoolId, grade, section, startDate, endDate) {
        const start = startDate ? new Date(startDate) : undefined;
        const end = endDate ? new Date(endDate) : undefined;
        return await exam_model_1.Exam.getExamSchedule(schoolId, grade, section, start, end);
    }
    async submitExamResults(data, userId) {
        const exam = await exam_model_1.Exam.findById(data.examId);
        if (!exam) {
            throw new AppError_1.AppError(404, "Exam not found");
        }
        const teacher = await teacher_model_1.Teacher.findOne({ userId });
        if (!teacher || exam.teacherId.toString() !== teacher._id.toString()) {
            throw new AppError_1.AppError(403, "Not authorized to submit results for this exam");
        }
        const eligibleStudents = await exam.getEligibleStudents();
        const eligibleStudentIds = eligibleStudents.map((s) => s._id.toString());
        const invalidStudents = data.results.filter((result) => !eligibleStudentIds.includes(result.studentId));
        if (invalidStudents.length > 0) {
            throw new AppError_1.AppError(400, "Some students are not eligible for this exam");
        }
        const invalidMarks = data.results.filter((result) => !result.isAbsent &&
            result.marksObtained !== undefined &&
            result.marksObtained > exam.totalMarks);
        if (invalidMarks.length > 0) {
            throw new AppError_1.AppError(400, "Some marks exceed the total marks for this exam");
        }
        const results = [];
        for (const resultData of data.results) {
            let existingResult = await exam_model_1.ExamResult.findOne({
                examId: exam._id,
                studentId: resultData.studentId,
            });
            const resultInfo = {
                examId: exam._id,
                studentId: new mongoose_1.Types.ObjectId(resultData.studentId),
                marksObtained: resultData.isAbsent ? 0 : resultData.marksObtained || 0,
                isAbsent: resultData.isAbsent || false,
                remarks: resultData.remarks,
                checkedBy: new mongoose_1.Types.ObjectId(userId),
                checkedAt: new Date(),
            };
            if (existingResult) {
                Object.assign(existingResult, resultInfo);
                await existingResult.save();
                results.push(existingResult);
            }
            else {
                const newResult = await exam_model_1.ExamResult.create(resultInfo);
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
    async publishExamResults(id, userId) {
        const exam = await exam_model_1.Exam.findById(id);
        if (!exam) {
            throw new AppError_1.AppError(404, "Exam not found");
        }
        const teacher = await teacher_model_1.Teacher.findOne({ userId });
        if (!teacher || exam.teacherId.toString() !== teacher._id.toString()) {
            throw new AppError_1.AppError(403, "Not authorized to publish results for this exam");
        }
        if (!exam.isCompleted()) {
            throw new AppError_1.AppError(400, "Cannot publish results for ongoing or future exam");
        }
        const resultCount = await exam_model_1.ExamResult.countDocuments({ examId: id });
        if (resultCount === 0) {
            throw new AppError_1.AppError(400, "No results found to publish");
        }
        exam.resultsPublished = true;
        await exam.save();
        const updatedExam = await exam_model_1.Exam.findById(id)
            .populate("teacherId", "userId teacherId")
            .populate("subjectId", "name code")
            .populate("schoolId", "name")
            .populate("createdBy", "firstName lastName");
        return this.formatExamResponse(updatedExam);
    }
    async getExamResults(examId, userId, userRole) {
        const exam = await exam_model_1.Exam.findById(examId);
        if (!exam) {
            throw new AppError_1.AppError(404, "Exam not found");
        }
        if (userRole === "teacher") {
            const teacher = await teacher_model_1.Teacher.findOne({ userId });
            if (!teacher || exam.teacherId.toString() !== teacher._id.toString()) {
                throw new AppError_1.AppError(403, "Not authorized to view results for this exam");
            }
        }
        else if (userRole === "student") {
            if (!exam.resultsPublished) {
                throw new AppError_1.AppError(403, "Results not yet published");
            }
        }
        const results = await exam_model_1.ExamResult.find({ examId })
            .populate({
            path: "studentId",
            select: "userId rollNumber",
            populate: {
                path: "userId",
                select: "firstName lastName",
            },
        })
            .sort({ marksObtained: -1 });
        if (userRole === "student") {
            const student = await student_model_1.Student.findOne({ userId });
            if (!student) {
                throw new AppError_1.AppError(404, "Student not found");
            }
            const studentResult = results.find((result) => result.studentId._id.toString() === student._id.toString());
            return studentResult ? [studentResult] : [];
        }
        return results;
    }
    async getExamStatistics(examId, userId, userRole) {
        const exam = await exam_model_1.Exam.findById(examId);
        if (!exam) {
            throw new AppError_1.AppError(404, "Exam not found");
        }
        if (userRole === "teacher") {
            const teacher = await teacher_model_1.Teacher.findOne({ userId });
            if (!teacher || exam.teacherId.toString() !== teacher._id.toString()) {
                throw new AppError_1.AppError(403, "Not authorized to view statistics for this exam");
            }
        }
        return await exam_model_1.Exam.getExamStats(exam.schoolId.toString(), examId);
    }
    async getUpcomingExams(schoolId, days = 30) {
        const exams = await exam_model_1.Exam.findUpcoming(schoolId, days);
        return exams.map((exam) => this.formatExamResponse(exam));
    }
    async getExamCalendar(schoolId, startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const exams = await exam_model_1.Exam.findByDateRange(schoolId, start, end);
        const examsByDate = {};
        exams.forEach((exam) => {
            const dateKey = exam.examDate.toISOString().split("T")[0];
            if (!examsByDate[dateKey]) {
                examsByDate[dateKey] = [];
            }
            examsByDate[dateKey].push(this.formatExamResponse(exam));
        });
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
                upcomingExams: exams.filter((exam) => exam.isUpcoming()).length,
                ongoingExams: exams.filter((exam) => exam.isOngoing()).length,
                completedExams: exams.filter((exam) => exam.isCompleted()).length,
                publishedExams: exams.filter((exam) => exam.isPublished).length,
            },
        };
    }
    hasTimeConflict(startTime1, endTime1, startTime2, endTime2) {
        const [start1Hours, start1Minutes] = startTime1.split(":").map(Number);
        const [end1Hours, end1Minutes] = endTime1.split(":").map(Number);
        const [start2Hours, start2Minutes] = startTime2.split(":").map(Number);
        const [end2Hours, end2Minutes] = endTime2.split(":").map(Number);
        const start1TotalMinutes = start1Hours * 60 + start1Minutes;
        const end1TotalMinutes = end1Hours * 60 + end1Minutes;
        const start2TotalMinutes = start2Hours * 60 + start2Minutes;
        const end2TotalMinutes = end2Hours * 60 + end2Minutes;
        return !(end1TotalMinutes <= start2TotalMinutes ||
            end2TotalMinutes <= start1TotalMinutes);
    }
    formatExamResponse(exam) {
        const formatted = exam.toJSON();
        if (exam.schoolId && typeof exam.schoolId === "object") {
            formatted.school = {
                id: exam.schoolId._id.toString(),
                name: exam.schoolId.name,
            };
        }
        if (exam.teacherId && typeof exam.teacherId === "object") {
            const teacher = exam.teacherId;
            formatted.teacher = {
                id: teacher._id.toString(),
                userId: teacher.userId?.toString(),
                teacherId: teacher.teacherId,
                fullName: teacher.userId
                    ? `${teacher.userId.firstName} ${teacher.userId.lastName}`
                    : "Unknown Teacher",
            };
        }
        if (exam.subjectId && typeof exam.subjectId === "object") {
            const subject = exam.subjectId;
            formatted.subject = {
                id: subject._id.toString(),
                name: subject.name,
                code: subject.code,
            };
        }
        if (exam.createdBy && typeof exam.createdBy === "object") {
            const creator = exam.createdBy;
            formatted.createdBy = {
                id: creator._id.toString(),
                fullName: `${creator.firstName} ${creator.lastName}`,
            };
        }
        return formatted;
    }
}
exports.examService = new ExamService();
//# sourceMappingURL=exam.service.js.map