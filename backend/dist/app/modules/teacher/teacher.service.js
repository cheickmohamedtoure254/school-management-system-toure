"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.teacherService = void 0;
const http_status_1 = __importDefault(require("http-status"));
const mongoose_1 = require("mongoose");
const path_1 = __importDefault(require("path"));
const config_1 = __importDefault(require("../../config"));
const AppError_1 = require("../../errors/AppError");
const fileUtils_1 = require("../../utils/fileUtils");
const credentialGenerator_1 = require("../../utils/credentialGenerator");
const school_model_1 = require("../school/school.model");
const user_model_1 = require("../user/user.model");
const teacher_model_1 = require("./teacher.model");
const subject_model_1 = require("../subject/subject.model");
const schedule_model_1 = require("../schedule/schedule.model");
const attendance_model_1 = require("../attendance/attendance.model");
const student_model_1 = require("../student/student.model");
const day_attendance_model_1 = require("../attendance/day-attendance.model");
const holiday_utils_1 = require("../attendance/holiday-utils");
const homework_model_1 = require("../homework/homework.model");
const notification_model_1 = require("../notification/notification.model");
class TeacherService {
    async createTeacher(teacherData, files) {
        const session = await (0, mongoose_1.startSession)();
        session.startTransaction();
        try {
            const school = await school_model_1.School.findById(new mongoose_1.Types.ObjectId(teacherData.schoolId));
            if (!school) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "School not found");
            }
            if (school.status !== "active") {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Cannot create teacher for inactive school");
            }
            const joiningYear = teacherData.joinDate
                ? new Date(teacherData.joinDate).getFullYear()
                : new Date().getFullYear();
            const { teacherId, employeeId } = await credentialGenerator_1.CredentialGenerator.generateUniqueTeacherId(joiningYear, teacherData.schoolId, teacherData.designation);
            const credentials = await credentialGenerator_1.CredentialGenerator.generateTeacherCredentials(teacherData.firstName, teacherData.lastName, teacherId);
            const newUser = await user_model_1.User.create([
                {
                    schoolId: new mongoose_1.Types.ObjectId(teacherData.schoolId),
                    role: "teacher",
                    username: credentials.username,
                    passwordHash: credentials.hashedPassword,
                    displayPassword: credentials.password,
                    firstName: teacherData.firstName,
                    lastName: teacherData.lastName,
                    email: teacherData.email,
                    phone: teacherData.phone,
                    isActive: teacherData.isActive !== false,
                    requiresPasswordChange: credentials.requiresPasswordChange,
                },
            ], { session });
            const experienceData = {
                totalYears: teacherData.experience.totalYears,
                previousSchools: teacherData.experience.previousSchools?.map((school) => ({
                    ...school,
                    fromDate: new Date(school.fromDate),
                    toDate: new Date(school.toDate),
                })) || [],
            };
            const newTeacher = await teacher_model_1.Teacher.create([
                {
                    userId: newUser[0]._id,
                    schoolId: new mongoose_1.Types.ObjectId(teacherData.schoolId),
                    teacherId,
                    employeeId: employeeId,
                    subjects: teacherData.subjects,
                    grades: teacherData.grades,
                    sections: teacherData.sections,
                    designation: teacherData.designation,
                    bloodGroup: teacherData.bloodGroup,
                    dob: new Date(teacherData.dob),
                    joinDate: teacherData.joinDate
                        ? new Date(teacherData.joinDate)
                        : new Date(),
                    qualifications: teacherData.qualifications,
                    experience: experienceData,
                    address: teacherData.address,
                    emergencyContact: teacherData.emergencyContact,
                    salary: teacherData.salary
                        ? {
                            ...teacherData.salary,
                            netSalary: (teacherData.salary.basic || 0) +
                                (teacherData.salary.allowances || 0) -
                                (teacherData.salary.deductions || 0),
                        }
                        : undefined,
                    isClassTeacher: teacherData.isClassTeacher || false,
                    classTeacherFor: teacherData.classTeacherFor,
                    isActive: teacherData.isActive !== false,
                },
            ], { session });
            const age = new Date().getFullYear() - new Date(teacherData.dob).getFullYear();
            const joinDate = new Date(teacherData.joinDate || Date.now())
                .toISOString()
                .split("T")[0];
            let folderPath = null;
            try {
                folderPath = await fileUtils_1.FileUtils.createTeacherPhotoFolder(school.name, {
                    firstName: teacherData.firstName,
                    age,
                    bloodGroup: teacherData.bloodGroup,
                    joinDate,
                    teacherId,
                });
            }
            catch (error) {
                console.warn("Failed to create photo folder:", error);
            }
            const photoResponses = [];
            if (files && files.length > 0 && folderPath) {
                try {
                    for (const file of files) {
                        const validation = fileUtils_1.FileUtils.validateImageFile(file);
                        if (!validation.isValid) {
                            throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, validation.error);
                        }
                    }
                    if (files.length > config_1.default.max_photos_per_student) {
                        throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, `Cannot upload more than ${config_1.default.max_photos_per_student} photos`);
                    }
                    const availableNumbers = await fileUtils_1.FileUtils.getAvailablePhotoNumbers(folderPath);
                    if (files.length > availableNumbers.length) {
                        throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, `Only ${availableNumbers.length} photo slots available`);
                    }
                    const uploadPromises = files.map(async (file, index) => {
                        const photoNumber = availableNumbers[index];
                        const photoResult = await fileUtils_1.FileUtils.savePhotoWithNumber(file, folderPath, photoNumber);
                        const photoDoc = await teacher_model_1.TeacherPhoto.create([
                            {
                                teacherId: newTeacher[0]._id,
                                schoolId: new mongoose_1.Types.ObjectId(teacherData.schoolId),
                                photoPath: photoResult.relativePath,
                                photoNumber,
                                filename: photoResult.filename,
                                originalName: file.originalname,
                                mimetype: file.mimetype,
                                size: file.size,
                            },
                        ], { session });
                        return {
                            id: photoDoc[0]._id.toString(),
                            photoPath: photoDoc[0].photoPath,
                            photoNumber: photoDoc[0].photoNumber,
                            filename: photoDoc[0].filename,
                            size: photoDoc[0].size,
                            createdAt: photoDoc[0].createdAt,
                        };
                    });
                    const uploadedPhotos = await Promise.all(uploadPromises);
                    photoResponses.push(...uploadedPhotos);
                }
                catch (error) {
                    console.error("Photo upload failed:", error);
                }
            }
            await session.commitTransaction();
            await newTeacher[0].populate([
                { path: "userId", select: "firstName lastName username email phone" },
                { path: "schoolId", select: "name" },
            ]);
            const response = await this.formatTeacherResponse(newTeacher[0]);
            if (photoResponses.length > 0) {
                response.photos = photoResponses;
                response.photoCount = photoResponses.length;
            }
            response.credentials = {
                username: credentials.username,
                password: credentials.password,
                teacherId: teacherId,
                employeeId: employeeId,
            };
            return response;
        }
        catch (error) {
            await session.abortTransaction();
            if (error instanceof AppError_1.AppError) {
                throw error;
            }
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to create teacher: ${error.message}`);
        }
        finally {
            session.endSession();
        }
    }
    async getTeachers(queryParams) {
        try {
            const { page, limit, schoolId, subject, grade, designation, isActive, isClassTeacher, search, sortBy, sortOrder, } = queryParams;
            const skip = (page - 1) * limit;
            const query = {};
            if (schoolId) {
                query.schoolId = new mongoose_1.Types.ObjectId(schoolId);
            }
            if (subject) {
                query.subjects = subject;
            }
            if (grade) {
                query.grades = grade;
            }
            if (designation) {
                query.designation = designation;
            }
            if (isActive && isActive !== "all") {
                query.isActive = isActive === "true";
            }
            if (isClassTeacher) {
                query.isClassTeacher = isClassTeacher === "true";
            }
            let userQuery = {};
            if (search) {
                userQuery.$or = [
                    { firstName: { $regex: new RegExp(search, "i") } },
                    { lastName: { $regex: new RegExp(search, "i") } },
                    { username: { $regex: new RegExp(search, "i") } },
                ];
            }
            let userIds = [];
            if (Object.keys(userQuery).length > 0) {
                const matchingUsers = await user_model_1.User.find(userQuery).select("_id");
                userIds = matchingUsers.map((user) => user._id);
                query.userId = { $in: userIds };
            }
            if (search && !userQuery.$or) {
                query.$or = [
                    { teacherId: { $regex: new RegExp(search, "i") } },
                    { employeeId: { $regex: new RegExp(search, "i") } },
                ];
            }
            const sort = {};
            if (sortBy === "firstName" || sortBy === "lastName") {
                sort.designation = 1;
                sort.joinDate = -1;
            }
            else if (sortBy === "experience.totalYears") {
                sort["experience.totalYears"] = sortOrder === "desc" ? -1 : 1;
            }
            else {
                sort[sortBy] = sortOrder === "desc" ? -1 : 1;
            }
            const aggregationPipeline = [
                { $match: query },
                {
                    $lookup: {
                        from: "users",
                        localField: "userId",
                        foreignField: "_id",
                        as: "user",
                        pipeline: [
                            {
                                $project: {
                                    firstName: 1,
                                    lastName: 1,
                                    username: 1,
                                    email: 1,
                                    phone: 1,
                                    isActive: 1,
                                },
                            },
                        ],
                    },
                },
                {
                    $lookup: {
                        from: "schools",
                        localField: "schoolId",
                        foreignField: "_id",
                        as: "school",
                        pipeline: [
                            {
                                $project: {
                                    name: 1,
                                },
                            },
                        ],
                    },
                },
                {
                    $addFields: {
                        user: { $arrayElemAt: ["$user", 0] },
                        school: { $arrayElemAt: ["$school", 0] },
                    },
                },
                { $sort: sort },
                { $skip: skip },
                { $limit: limit },
            ];
            const [teachers, totalCount] = await Promise.all([
                teacher_model_1.Teacher.aggregate(aggregationPipeline),
                teacher_model_1.Teacher.countDocuments(query),
            ]);
            const totalPages = Math.ceil(totalCount / limit);
            const formattedTeachers = await Promise.all(teachers.map((teacher) => this.formatTeacherResponse(teacher)));
            return {
                teachers: formattedTeachers,
                totalCount,
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
            };
        }
        catch (error) {
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to fetch teachers: ${error.message}`);
        }
    }
    async getTeacherById(id) {
        try {
            if (!mongoose_1.Types.ObjectId.isValid(id)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid teacher ID format");
            }
            const teacher = await teacher_model_1.Teacher.findById(id)
                .populate("userId", "firstName lastName username email phone")
                .populate("schoolId", "name")
                .populate("photos")
                .populate("photoCount")
                .lean();
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            if (teacher.subjects && teacher.subjects.length > 0) {
                const subjectObjectIds = teacher.subjects.filter((subject) => typeof subject === "string" && /^[0-9a-fA-F]{24}$/.test(subject));
                if (subjectObjectIds.length > 0) {
                    const { Subject } = await Promise.resolve().then(() => __importStar(require("../subject/subject.model")));
                    const subjectDocs = await Subject.find({
                        _id: { $in: subjectObjectIds.map((id) => new mongoose_1.Types.ObjectId(id)) },
                    }).select("name");
                    const subjectMap = new Map(subjectDocs.map((doc) => [doc._id.toString(), doc.name]));
                    teacher.subjects = teacher.subjects.map((subject) => {
                        if (typeof subject === "string" &&
                            /^[0-9a-fA-F]{24}$/.test(subject)) {
                            return subjectMap.get(subject) || subject;
                        }
                        return subject;
                    });
                }
            }
            return await this.formatTeacherResponse(teacher);
        }
        catch (error) {
            if (error instanceof AppError_1.AppError) {
                throw error;
            }
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to fetch teacher: ${error.message}`);
        }
    }
    async updateTeacher(id, updateData) {
        try {
            if (!mongoose_1.Types.ObjectId.isValid(id)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid teacher ID format");
            }
            const teacher = await teacher_model_1.Teacher.findById(id);
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const userUpdateData = {};
            if (updateData.firstName)
                userUpdateData.firstName = updateData.firstName;
            if (updateData.lastName)
                userUpdateData.lastName = updateData.lastName;
            if (updateData.email)
                userUpdateData.email = updateData.email;
            if (updateData.phone)
                userUpdateData.phone = updateData.phone;
            if (Object.keys(userUpdateData).length > 0) {
                await user_model_1.User.findByIdAndUpdate(teacher.userId, { $set: userUpdateData }, { new: true, runValidators: true });
            }
            const teacherUpdateData = { ...updateData };
            delete teacherUpdateData.firstName;
            delete teacherUpdateData.lastName;
            delete teacherUpdateData.email;
            delete teacherUpdateData.phone;
            if (teacherUpdateData.dob) {
                teacherUpdateData.dob = new Date(teacherUpdateData.dob);
            }
            if (teacherUpdateData.joinDate) {
                teacherUpdateData.joinDate = new Date(teacherUpdateData.joinDate);
            }
            if (teacherUpdateData.salary) {
                const basic = teacherUpdateData.salary.basic || 0;
                const allowances = teacherUpdateData.salary.allowances || 0;
                const deductions = teacherUpdateData.salary.deductions || 0;
                teacherUpdateData.salary = {
                    ...teacherUpdateData.salary,
                    netSalary: basic + allowances - deductions,
                };
            }
            const updatedTeacher = await teacher_model_1.Teacher.findByIdAndUpdate(id, { $set: teacherUpdateData }, { new: true, runValidators: true })
                .populate("userId", "firstName lastName username email phone")
                .populate("schoolId", "name")
                .populate("photoCount")
                .lean();
            return await this.formatTeacherResponse(updatedTeacher);
        }
        catch (error) {
            if (error instanceof AppError_1.AppError) {
                throw error;
            }
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to update teacher: ${error.message}`);
        }
    }
    async deleteTeacher(id) {
        try {
            if (!mongoose_1.Types.ObjectId.isValid(id)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid teacher ID format");
            }
            const teacher = await teacher_model_1.Teacher.findById(id)
                .populate("userId", "firstName lastName")
                .populate("schoolId", "name");
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            if (teacher.userId) {
                await user_model_1.User.findByIdAndDelete(teacher.userId);
            }
            try {
                const age = new Date().getFullYear() - new Date(teacher.dob).getFullYear();
                const joinDate = teacher.joinDate.toISOString().split("T")[0];
                const folderPath = await fileUtils_1.FileUtils.createTeacherPhotoFolder(teacher.schoolId.name, {
                    firstName: teacher.userId.firstName,
                    age,
                    bloodGroup: teacher.bloodGroup,
                    joinDate,
                    teacherId: teacher.teacherId,
                });
                await fileUtils_1.FileUtils.deleteFolder(folderPath);
            }
            catch (error) {
                console.warn("Failed to delete photo folder:", error);
            }
            await teacher.deleteOne();
        }
        catch (error) {
            if (error instanceof AppError_1.AppError) {
                throw error;
            }
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to delete teacher: ${error.message}`);
        }
    }
    async uploadPhotos(teacherId, files) {
        try {
            if (!mongoose_1.Types.ObjectId.isValid(teacherId)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid teacher ID format");
            }
            const teacher = await teacher_model_1.Teacher.findById(teacherId)
                .populate("userId", "firstName lastName")
                .populate("schoolId", "name");
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const currentPhotoCount = await teacher_model_1.TeacherPhoto.countDocuments({
                teacherId,
            });
            const remainingSlots = config_1.default.max_photos_per_student - currentPhotoCount;
            if (files.length > remainingSlots) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, `Can only upload ${remainingSlots} more photos. Maximum ${config_1.default.max_photos_per_student} photos allowed per teacher.`);
            }
            for (const file of files) {
                const validation = fileUtils_1.FileUtils.validateImageFile(file);
                if (!validation.isValid) {
                    throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, validation.error);
                }
            }
            const age = new Date().getFullYear() - new Date(teacher.dob).getFullYear();
            const joinDate = teacher.joinDate.toISOString().split("T")[0];
            const folderPath = await fileUtils_1.FileUtils.createTeacherPhotoFolder(teacher.schoolId.name, {
                firstName: teacher.userId.firstName,
                age,
                bloodGroup: teacher.bloodGroup,
                joinDate,
                teacherId: teacher.teacherId,
            });
            const availableNumbers = await fileUtils_1.FileUtils.getAvailablePhotoNumbers(folderPath);
            if (files.length > availableNumbers.length) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, `Only ${availableNumbers.length} photo slots available`);
            }
            const uploadedPhotos = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const photoNumber = availableNumbers[i];
                const fileInfo = await fileUtils_1.FileUtils.savePhotoWithNumber(file, folderPath, photoNumber);
                const photoRecord = await teacher_model_1.TeacherPhoto.create({
                    teacherId,
                    schoolId: teacher.schoolId,
                    photoPath: fileInfo.relativePath,
                    photoNumber,
                    filename: fileInfo.filename,
                    originalName: file.originalname,
                    mimetype: file.mimetype,
                    size: file.size,
                });
                uploadedPhotos.push({
                    id: photoRecord._id.toString(),
                    photoPath: photoRecord.photoPath,
                    photoNumber: photoRecord.photoNumber,
                    filename: photoRecord.filename,
                    size: photoRecord.size,
                    createdAt: photoRecord.createdAt,
                });
            }
            return uploadedPhotos;
        }
        catch (error) {
            if (error instanceof AppError_1.AppError) {
                throw error;
            }
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to upload photos: ${error.message}`);
        }
    }
    async deletePhoto(teacherId, photoId) {
        try {
            if (!mongoose_1.Types.ObjectId.isValid(teacherId) ||
                !mongoose_1.Types.ObjectId.isValid(photoId)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid ID format");
            }
            const photo = await teacher_model_1.TeacherPhoto.findOne({ _id: photoId, teacherId });
            if (!photo) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Photo not found");
            }
            const fullPath = path_1.default.resolve(config_1.default.upload_path, photo.photoPath);
            await fileUtils_1.FileUtils.deleteFile(fullPath);
            await photo.deleteOne();
        }
        catch (error) {
            if (error instanceof AppError_1.AppError) {
                throw error;
            }
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to delete photo: ${error.message}`);
        }
    }
    async getTeachersBySubject(schoolId, subject) {
        try {
            if (!mongoose_1.Types.ObjectId.isValid(schoolId)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid school ID format");
            }
            const teachers = await teacher_model_1.Teacher.findBySubject(schoolId, subject);
            return await Promise.all(teachers.map((teacher) => this.formatTeacherResponse(teacher)));
        }
        catch (error) {
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to fetch teachers by subject: ${error.message}`);
        }
    }
    async getTeacherStats(schoolId) {
        try {
            if (!mongoose_1.Types.ObjectId.isValid(schoolId)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid school ID format");
            }
            const [totalTeachers, activeTeachers, classTeachers, designationStats, subjectStats, experienceStats, recentJoining,] = await Promise.all([
                teacher_model_1.Teacher.countDocuments({ schoolId: new mongoose_1.Types.ObjectId(schoolId) }),
                teacher_model_1.Teacher.countDocuments({
                    schoolId: new mongoose_1.Types.ObjectId(schoolId),
                    isActive: true,
                }),
                teacher_model_1.Teacher.countDocuments({
                    schoolId: new mongoose_1.Types.ObjectId(schoolId),
                    isClassTeacher: true,
                }),
                teacher_model_1.Teacher.aggregate([
                    { $match: { schoolId: new mongoose_1.Types.ObjectId(schoolId) } },
                    { $group: { _id: "$designation", count: { $sum: 1 } } },
                    { $sort: { _id: 1 } },
                ]),
                teacher_model_1.Teacher.aggregate([
                    { $match: { schoolId: new mongoose_1.Types.ObjectId(schoolId) } },
                    { $unwind: "$subjects" },
                    { $group: { _id: "$subjects", count: { $sum: 1 } } },
                    { $sort: { _id: 1 } },
                ]),
                teacher_model_1.Teacher.aggregate([
                    { $match: { schoolId: new mongoose_1.Types.ObjectId(schoolId) } },
                    {
                        $group: {
                            _id: {
                                $switch: {
                                    branches: [
                                        {
                                            case: { $lt: ["$experience.totalYears", 2] },
                                            then: "0-2 years",
                                        },
                                        {
                                            case: { $lt: ["$experience.totalYears", 5] },
                                            then: "2-5 years",
                                        },
                                        {
                                            case: { $lt: ["$experience.totalYears", 10] },
                                            then: "5-10 years",
                                        },
                                        {
                                            case: { $lt: ["$experience.totalYears", 20] },
                                            then: "10-20 years",
                                        },
                                    ],
                                    default: "20+ years",
                                },
                            },
                            count: { $sum: 1 },
                        },
                    },
                    { $sort: { _id: 1 } },
                ]),
                teacher_model_1.Teacher.countDocuments({
                    schoolId,
                    joinDate: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
                }),
            ]);
            return {
                totalTeachers,
                activeTeachers,
                classTeachers,
                byDesignation: designationStats.map((stat) => ({
                    designation: stat._id,
                    count: stat.count,
                })),
                bySubject: subjectStats.map((stat) => ({
                    subject: stat._id,
                    count: stat.count,
                })),
                byExperience: experienceStats.map((stat) => ({
                    experienceRange: stat._id,
                    count: stat.count,
                })),
                recentJoining,
            };
        }
        catch (error) {
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to fetch teacher stats: ${error.message}`);
        }
    }
    async getTeacherPhotos(teacherId) {
        try {
            if (!mongoose_1.Types.ObjectId.isValid(teacherId)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid teacher ID format");
            }
            const photos = await teacher_model_1.TeacherPhoto.find({ teacherId })
                .sort({ photoNumber: 1 })
                .lean();
            return photos.map((photo) => ({
                id: photo._id.toString(),
                photoPath: photo.photoPath,
                photoNumber: photo.photoNumber,
                filename: photo.filename,
                size: photo.size,
                createdAt: photo.createdAt,
            }));
        }
        catch (error) {
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to fetch teacher photos: ${error.message}`);
        }
    }
    async getAvailablePhotoSlots(teacherId) {
        try {
            if (!mongoose_1.Types.ObjectId.isValid(teacherId)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid teacher ID format");
            }
            const teacher = await teacher_model_1.Teacher.findById(teacherId)
                .populate("userId", "firstName")
                .populate("schoolId", "name");
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const age = new Date().getFullYear() - new Date(teacher.dob).getFullYear();
            const joinDate = teacher.joinDate.toISOString().split("T")[0];
            const folderPath = await fileUtils_1.FileUtils.createTeacherPhotoFolder(teacher.schoolId.name, {
                firstName: teacher.userId.firstName,
                age,
                bloodGroup: teacher.bloodGroup,
                joinDate,
                teacherId: teacher.teacherId,
            });
            return await fileUtils_1.FileUtils.getAvailablePhotoNumbers(folderPath);
        }
        catch (error) {
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to get available photo slots: ${error.message}`);
        }
    }
    async formatTeacherResponse(teacher) {
        const age = teacher.dob
            ? new Date().getFullYear() - new Date(teacher.dob).getFullYear()
            : 0;
        const totalExperience = teacher.experience?.totalYears || 0;
        let subjects = teacher.subjects || [];
        if (subjects.length > 0) {
            const subjectObjectIds = subjects.filter((subject) => typeof subject === "string" && /^[0-9a-fA-F]{24}$/.test(subject));
            if (subjectObjectIds.length > 0) {
                try {
                    const subjectDocs = await subject_model_1.Subject.find({
                        _id: {
                            $in: subjectObjectIds.map((id) => new mongoose_1.Types.ObjectId(id)),
                        },
                    }).select("name");
                    const subjectMap = new Map(subjectDocs.map((doc) => [doc._id.toString(), doc.name]));
                    subjects = subjects.map((subject) => {
                        if (typeof subject === "string" &&
                            /^[0-9a-fA-F]{24}$/.test(subject)) {
                            return subjectMap.get(subject) || subject;
                        }
                        return subject;
                    });
                }
                catch (error) {
                    console.warn("Failed to convert subject ObjectIds to names:", error);
                }
            }
        }
        return {
            id: teacher._id?.toString() || teacher.id,
            userId: teacher.userId?._id?.toString() || teacher.userId?.toString(),
            schoolId: teacher.schoolId?._id?.toString() || teacher.schoolId?.toString(),
            teacherId: teacher.teacherId,
            employeeId: teacher.employeeId,
            subjects: subjects,
            grades: teacher.grades || [],
            sections: teacher.sections || [],
            designation: teacher.designation,
            bloodGroup: teacher.bloodGroup,
            dob: teacher.dob,
            joinDate: teacher.joinDate,
            qualifications: teacher.qualifications || [],
            experience: {
                totalYears: teacher.experience?.totalYears || 0,
                previousSchools: teacher.experience?.previousSchools || [],
            },
            address: teacher.address,
            emergencyContact: teacher.emergencyContact,
            salary: teacher.salary,
            isClassTeacher: teacher.isClassTeacher || false,
            classTeacherFor: teacher.classTeacherFor,
            isActive: teacher.isActive !== false,
            age,
            totalExperience,
            createdAt: teacher.createdAt,
            updatedAt: teacher.updatedAt,
            user: teacher.userId || teacher.user
                ? {
                    id: (teacher.userId?._id ||
                        teacher.user?._id ||
                        teacher.userId?.id ||
                        teacher.user?.id)?.toString(),
                    username: teacher.userId?.username || teacher.user?.username,
                    firstName: teacher.userId?.firstName || teacher.user?.firstName,
                    lastName: teacher.userId?.lastName || teacher.user?.lastName,
                    fullName: `${teacher.userId?.firstName || teacher.user?.firstName || ""} ${teacher.userId?.lastName || teacher.user?.lastName || ""}`.trim() || "Unknown User",
                    email: teacher.userId?.email || teacher.user?.email,
                    phone: teacher.userId?.phone || teacher.user?.phone,
                }
                : {
                    id: "",
                    username: "unknown",
                    firstName: "Unknown",
                    lastName: "User",
                    fullName: "Unknown User",
                    email: "",
                    phone: "",
                },
            school: teacher.schoolId?.name
                ? {
                    id: teacher.schoolId._id?.toString() || teacher.schoolId.id,
                    name: teacher.schoolId.name,
                }
                : undefined,
            photos: teacher.photos?.map((photo) => ({
                id: photo._id?.toString() || photo.id,
                photoPath: photo.photoPath,
                photoNumber: photo.photoNumber,
                filename: photo.filename,
                size: photo.size,
                createdAt: photo.createdAt,
            })) || [],
            photoCount: teacher.photoCount || 0,
        };
    }
    async getTeacherDashboard(userId) {
        try {
            const teacher = await teacher_model_1.Teacher.findOne({ userId })
                .populate("schoolId", "name")
                .populate("userId", "firstName lastName username");
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const today = new Date();
            const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
            const totalClasses = teacher.grades.length * teacher.sections.length;
            const totalStudents = await student_model_1.Student.countDocuments({
                schoolId: teacher.schoolId,
                grade: { $in: teacher.grades },
                section: { $in: teacher.sections },
                isActive: true,
            });
            const now = new Date();
            const pendingHomework = await homework_model_1.Homework.countDocuments({
                teacherId: teacher._id,
                dueDate: { $gte: now },
                isPublished: true,
            });
            const schedules = await schedule_model_1.Schedule.find({
                "periods.teacherId": teacher._id,
                isActive: true,
            });
            let todayClasses = 0;
            const todayDayOfWeek = today
                .toLocaleString("en-US", { weekday: "long" })
                .toLowerCase();
            schedules.forEach((schedule) => {
                if (schedule.dayOfWeek &&
                    schedule.dayOfWeek.toLowerCase() === todayDayOfWeek) {
                    todayClasses += schedule.periods.filter((p) => String(p.teacherId) === String(teacher._id)).length;
                }
            });
            const dashboardData = {
                teacher: {
                    id: teacher._id,
                    name: `${teacher.userId?.firstName || ""} ${teacher.userId?.lastName || ""}`.trim(),
                    subjects: teacher.subjects,
                    grades: teacher.grades,
                    sections: teacher.sections,
                },
                totalClasses,
                totalStudents,
                pendingHomework,
                todayClasses,
                upcomingClasses: [],
                recentActivity: [],
            };
            return dashboardData;
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to get teacher dashboard: ${error.message}`);
        }
    }
    async getTeacherSchedule(userId) {
        try {
            const teacher = await teacher_model_1.Teacher.findOne({ userId }).populate("schoolId", "name");
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const schedules = await schedule_model_1.Schedule.findByTeacher(teacher._id.toString());
            const weeklySchedule = {
                monday: [],
                tuesday: [],
                wednesday: [],
                thursday: [],
                friday: [],
                saturday: [],
                sunday: [],
            };
            let totalPeriodsPerWeek = 0;
            const subjectsCount = new Set();
            const classesCount = new Set();
            schedules.forEach((schedule) => {
                const teacherPeriods = schedule.getPeriodsForTeacher(teacher._id.toString());
                teacherPeriods.forEach((period) => {
                    const scheduleEntry = {
                        scheduleId: schedule._id,
                        grade: schedule.grade,
                        section: schedule.section,
                        className: `Grade ${schedule.grade} - Section ${schedule.section}`,
                        periodNumber: period.periodNumber,
                        startTime: period.startTime,
                        endTime: period.endTime,
                        subject: {
                            id: period.subjectId?._id || period.subjectId,
                            name: period.subjectId?.name || "Unknown Subject",
                            code: period.subjectId?.code || "N/A",
                        },
                        roomNumber: period.roomNumber,
                        venue: period.roomNumber,
                        duration: this.calculateDuration(period.startTime, period.endTime),
                    };
                    weeklySchedule[schedule.dayOfWeek].push(scheduleEntry);
                    totalPeriodsPerWeek++;
                    subjectsCount.add(scheduleEntry.subject.name);
                    classesCount.add(`${schedule.grade}-${schedule.section}`);
                });
            });
            Object.keys(weeklySchedule).forEach((day) => {
                weeklySchedule[day].sort((a, b) => {
                    if (a.startTime < b.startTime)
                        return -1;
                    if (a.startTime > b.startTime)
                        return 1;
                    return a.periodNumber - b.periodNumber;
                });
            });
            const today = new Date();
            const dayNames = [
                "sunday",
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
            ];
            const todayName = dayNames[today.getDay()];
            const todaySchedule = weeklySchedule[todayName] || [];
            const currentTime = new Date();
            const currentTimeString = `${currentTime
                .getHours()
                .toString()
                .padStart(2, "0")}:${currentTime
                .getMinutes()
                .toString()
                .padStart(2, "0")}`;
            const currentPeriod = todaySchedule.find((period) => {
                return (currentTimeString >= period.startTime &&
                    currentTimeString <= period.endTime);
            });
            const nextPeriod = todaySchedule.find((period) => {
                return currentTimeString < period.startTime;
            });
            return {
                teacher: {
                    id: teacher._id,
                    teacherId: teacher.teacherId,
                    name: `${teacher.userId?.firstName || ""} ${teacher.userId?.lastName || ""}`.trim(),
                    subjects: teacher.subjects,
                    grades: teacher.grades,
                    sections: teacher.sections,
                    designation: teacher.designation,
                    isClassTeacher: teacher.isClassTeacher,
                    classTeacherFor: teacher.classTeacherFor,
                },
                weeklySchedule,
                todaySchedule,
                currentPeriod,
                nextPeriod,
                statistics: {
                    totalPeriodsPerWeek,
                    uniqueSubjects: subjectsCount.size,
                    uniqueClasses: classesCount.size,
                    averagePeriodsPerDay: Math.round((totalPeriodsPerWeek / 6) * 10) / 10,
                    busyDays: Object.keys(weeklySchedule).filter((day) => weeklySchedule[day].length > 0).length,
                },
            };
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to get teacher schedule: ${error.message}`);
        }
    }
    calculateDuration(startTime, endTime) {
        const [startHour, startMin] = startTime.split(":").map(Number);
        const [endHour, endMin] = endTime.split(":").map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;
        return endMinutes - startMinutes;
    }
    async getTeacherClasses(userId) {
        try {
            const teacher = await teacher_model_1.Teacher.findOne({ userId }).populate("schoolId", "name");
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const schedules = await schedule_model_1.Schedule.findByTeacher(teacher._id.toString());
            const classMap = new Map();
            schedules.forEach((schedule) => {
                const teacherPeriods = schedule.getPeriodsForTeacher(teacher._id.toString());
                if (teacherPeriods.length > 0) {
                    const classKey = `${schedule.grade}-${schedule.section}`;
                    if (!classMap.has(classKey)) {
                        classMap.set(classKey, {
                            grade: schedule.grade,
                            section: schedule.section,
                            subjects: new Set(),
                            totalPeriods: 0,
                            daysScheduled: new Set(),
                            studentsCount: 0,
                            classId: schedule.classId,
                        });
                    }
                    const classData = classMap.get(classKey);
                    teacherPeriods.forEach((period) => {
                        if (period.subjectId) {
                            const subjectName = period.subjectId?.name ||
                                teacher.subjects.find((s) => s === period.subjectId?.toString()) ||
                                period.subjectId.toString();
                            classData.subjects.add(subjectName);
                            classData.totalPeriods++;
                        }
                    });
                    classData.daysScheduled.add(schedule.dayOfWeek);
                }
            });
            const classes = Array.from(classMap.values()).map((classData) => ({
                grade: classData.grade,
                section: classData.section,
                className: `Grade ${classData.grade} - Section ${classData.section}`,
                subjects: Array.from(classData.subjects),
                totalPeriods: classData.totalPeriods,
                daysScheduled: Array.from(classData.daysScheduled),
                studentsCount: classData.studentsCount,
                classId: classData.classId,
            }));
            classes.sort((a, b) => {
                if (a.grade !== b.grade) {
                    return a.grade - b.grade;
                }
                return a.section.localeCompare(b.section);
            });
            return {
                teacher: {
                    id: teacher._id,
                    teacherId: teacher.teacherId,
                    name: `${teacher.userId?.firstName || ""} ${teacher.userId?.lastName || ""}`.trim(),
                    subjects: teacher.subjects,
                    grades: teacher.grades,
                    sections: teacher.sections,
                    designation: teacher.designation,
                    isClassTeacher: teacher.isClassTeacher,
                    classTeacherFor: teacher.classTeacherFor,
                },
                classes,
                summary: {
                    totalClasses: classes.length,
                    totalSubjects: [...new Set(classes.flatMap((c) => c.subjects))]
                        .length,
                    totalPeriods: classes.reduce((sum, c) => sum + c.totalPeriods, 0),
                },
            };
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to get teacher classes: ${error.message}`);
        }
    }
    async getCurrentPeriods(userId) {
        try {
            const teacher = await teacher_model_1.Teacher.findOne({ userId }).populate("schoolId userId");
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const now = new Date();
            const currentDay = now
                .toLocaleDateString("en-US", { weekday: "long" })
                .toLowerCase();
            const currentTime = now.toTimeString().substring(0, 5);
            const schoolTimezone = teacher.schoolId?.settings?.timezone ||
                config_1.default.school_timezone ||
                "UTC";
            const { dateKey } = (0, day_attendance_model_1.normaliseDateKey)(now, schoolTimezone);
            const schoolId = teacher.schoolId?._id || teacher.schoolId;
            const schedules = await schedule_model_1.Schedule.find({
                schoolId: teacher.schoolId,
                dayOfWeek: currentDay,
                isActive: true,
                "periods.teacherId": teacher._id,
            }).populate([
                {
                    path: "periods.subjectId",
                    select: "name code",
                },
                {
                    path: "classId",
                    select: "grade section name",
                },
            ]);
            const availablePeriods = [];
            const currentPeriods = [];
            const upcomingPeriods = [];
            const holidayPeriods = [];
            for (const schedule of schedules) {
                const holidayEvents = await (0, holiday_utils_1.findHolidayEventsForClass)({
                    schoolId,
                    dateKey,
                    timezone: schoolTimezone,
                    grade: schedule.grade,
                    section: schedule.section,
                });
                const isHoliday = holidayEvents.length > 0;
                for (const period of schedule.periods) {
                    if (period.teacherId?.toString() === teacher._id.toString() &&
                        !period.isBreak) {
                        const status = this.getPeriodTimeStatus(period.startTime, period.endTime, now);
                        const canMark = !isHoliday &&
                            this.canMarkAttendanceNow(period.startTime, period.endTime, now);
                        const periodData = {
                            scheduleId: schedule._id,
                            classId: schedule.classId._id || schedule.classId,
                            grade: schedule.grade,
                            section: schedule.section,
                            className: `Grade ${schedule.grade} - Section ${schedule.section}`,
                            periodNumber: period.periodNumber,
                            subject: period.subjectId
                                ? {
                                    id: period.subjectId._id || period.subjectId,
                                    name: period.subjectId.name || "Unknown Subject",
                                    code: period.subjectId.code || "UNK",
                                }
                                : {
                                    id: "",
                                    name: "No Subject",
                                    code: "N/A",
                                },
                            startTime: period.startTime,
                            endTime: period.endTime,
                            roomNumber: period.roomNumber,
                            canMarkAttendance: canMark,
                            timeStatus: status,
                            isHoliday,
                            holidayEvents: holidayEvents.map((event) => ({
                                id: event._id?.toString?.() ?? "",
                                title: event.title,
                                date: event.date,
                            })),
                        };
                        if (isHoliday) {
                            holidayPeriods.push(periodData);
                        }
                        if (canMark) {
                            currentPeriods.push(periodData);
                        }
                        else if (status === "upcoming") {
                            upcomingPeriods.push(periodData);
                        }
                        else {
                            availablePeriods.push(periodData);
                        }
                    }
                }
            }
            const holidayTitles = holidayPeriods
                .flatMap((period) => period.holidayEvents.map((event) => event.title).filter(Boolean))
                .filter((value, index, array) => value && array.indexOf(value) === index);
            return {
                currentPeriods,
                upcomingPeriods,
                allPeriods: availablePeriods,
                holidayPeriods,
                holidayNotice: holidayTitles.length
                    ? `Attendance is disabled today due to ${holidayTitles.join(", ")}`
                    : holidayPeriods.length
                        ? "Attendance is disabled today due to a school holiday."
                        : null,
                teacherInfo: {
                    id: teacher._id,
                    name: `${teacher.userId.firstName} ${teacher.userId.lastName}`,
                    teacherId: teacher.teacherId,
                },
                currentTime: now.toISOString(),
            };
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to get current periods: ${error.message}`);
        }
    }
    canMarkAttendanceNow(startTime, endTime, now) {
        if (!startTime || !endTime) {
            return false;
        }
        const currentTime = now.toTimeString().substring(0, 5);
        const [startHour, startMin] = startTime.split(":").map(Number);
        const [endHour, endMin] = endTime.split(":").map(Number);
        const [currentHour, currentMin] = currentTime.split(":").map(Number);
        const startMinutes = startHour * 60 + startMin - 5;
        const endMinutes = endHour * 60 + endMin;
        const currentMinutes = currentHour * 60 + currentMin;
        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }
    getPeriodTimeStatus(startTime, endTime, now) {
        if (!startTime || !endTime) {
            return "upcoming";
        }
        const currentTime = now.toTimeString().substring(0, 5);
        const [startHour, startMin] = startTime.split(":").map(Number);
        const [endHour, endMin] = endTime.split(":").map(Number);
        const [currentHour, currentMin] = currentTime.split(":").map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;
        const currentMinutes = currentHour * 60 + currentMin;
        if (currentMinutes < startMinutes)
            return "upcoming";
        if (currentMinutes <= endMinutes)
            return "current";
        return "past";
    }
    async markAttendance(userId, attendanceData) {
        try {
            const teacher = await teacher_model_1.Teacher.findOne({ userId }).populate("schoolId userId");
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const now = new Date();
            const currentDay = now
                .toLocaleDateString("en-US", { weekday: "long" })
                .toLowerCase();
            const attendanceDate = new Date(attendanceData.date);
            const schedule = await schedule_model_1.Schedule.findOne({
                schoolId: teacher.schoolId,
                grade: attendanceData.grade,
                section: attendanceData.section,
                dayOfWeek: currentDay,
                isActive: true,
                periods: {
                    $elemMatch: {
                        periodNumber: attendanceData.period,
                        teacherId: teacher._id,
                        subjectId: attendanceData.subjectId,
                    },
                },
            }).populate("periods.subjectId");
            if (!schedule) {
                throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, "You are not authorized to mark attendance for this class/subject/period");
            }
            const period = schedule.periods.find((p) => {
                let subjectId;
                if (p.subjectId &&
                    typeof p.subjectId === "object" &&
                    "_id" in p.subjectId) {
                    subjectId = p.subjectId._id.toString();
                }
                else if (p.subjectId) {
                    subjectId = String(p.subjectId);
                }
                else {
                    subjectId = "";
                }
                return (p.periodNumber === attendanceData.period &&
                    p.teacherId?.toString() === teacher._id.toString() &&
                    subjectId === attendanceData.subjectId);
            });
            if (!period) {
                throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, "Period not found in your schedule");
            }
            if (!this.canMarkAttendanceNow(period.startTime, period.endTime, now)) {
                const timeStatus = this.getPeriodTimeStatus(period.startTime, period.endTime, now);
                if (timeStatus === "past") {
                    throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, `Attendance marking window has closed. Period ended at ${period.endTime}`);
                }
                else {
                    throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, `Attendance marking window has not started yet. Period starts at ${period.startTime}`);
                }
            }
            const savedAttendance = await attendance_model_1.Attendance.markAttendance(teacher._id.toString(), attendanceData.classId, attendanceData.subjectId, attendanceDate, attendanceData.period, attendanceData.students);
            const stats = savedAttendance.getAttendanceStats();
            const absentStudents = savedAttendance.students.filter((s) => s.status === "absent");
            if (absentStudents.length > 0) {
                try {
                    for (const absentStudent of absentStudents) {
                        await notification_model_1.Notification.createAttendanceAlert({
                            studentId: absentStudent.studentId.toString(),
                            teacherId: teacher._id.toString(),
                            subjectName: period.subjectId.name,
                            className: `Grade ${attendanceData.grade} - Section ${attendanceData.section}`,
                            date: attendanceDate,
                            period: attendanceData.period,
                        });
                    }
                }
                catch (notificationError) {
                    console.error("Failed to send notifications:", notificationError);
                }
            }
            return {
                success: true,
                attendanceId: savedAttendance._id.toString(),
                totalStudents: stats.totalStudents,
                presentCount: stats.presentCount,
                absentCount: stats.absentCount,
                lateCount: stats.lateCount,
                excusedCount: stats.excusedCount,
                attendancePercentage: stats.attendancePercentage,
                markedAt: savedAttendance.markedAt.toISOString(),
                period: {
                    number: attendanceData.period,
                    startTime: period.startTime,
                    endTime: period.endTime,
                    subject: period.subjectId,
                    className: `Grade ${attendanceData.grade} - Section ${attendanceData.section}`,
                },
            };
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            if (error instanceof Error) {
                const message = error.message || "Failed to mark attendance";
                if (message.includes("locked")) {
                    throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, message);
                }
                if (message.includes("Cannot mark attendance")) {
                    throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, message);
                }
                throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to mark attendance: ${message}`);
            }
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, "Failed to mark attendance due to an unexpected error");
        }
    }
    async getStudentsForAttendance(userId, classId, subjectId, period) {
        try {
            if (!classId || !mongoose_1.Types.ObjectId.isValid(classId)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid classId provided");
            }
            if (!subjectId || !mongoose_1.Types.ObjectId.isValid(subjectId)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid subjectId provided");
            }
            const teacher = await teacher_model_1.Teacher.findOne({ userId }).populate("schoolId userId");
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const now = new Date();
            const currentDay = now
                .toLocaleDateString("en-US", { weekday: "long" })
                .toLowerCase();
            const schedule = await schedule_model_1.Schedule.findOne({
                schoolId: teacher.schoolId,
                classId: new mongoose_1.Types.ObjectId(classId),
                dayOfWeek: currentDay,
                isActive: true,
                periods: {
                    $elemMatch: {
                        periodNumber: period,
                        teacherId: teacher._id,
                        subjectId: new mongoose_1.Types.ObjectId(subjectId),
                    },
                },
            }).populate([
                {
                    path: "periods.subjectId",
                    select: "name code",
                },
                {
                    path: "classId",
                    select: "grade section name",
                },
            ]);
            if (!schedule) {
                throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, "You are not authorized to mark attendance for this class/subject/period");
            }
            const students = await student_model_1.Student.find({
                schoolId: teacher.schoolId,
                grade: schedule.grade,
                section: schedule.section,
                isActive: true,
            })
                .populate("userId", "firstName lastName")
                .sort({ rollNumber: 1 });
            const schoolTimezone = teacher.schoolId?.settings?.timezone ||
                config_1.default.school_timezone ||
                "UTC";
            const { date: attendanceDate, dateKey } = (0, day_attendance_model_1.normaliseDateKey)(now, schoolTimezone);
            const dateString = now.toISOString().split("T")[0];
            const schoolId = teacher.schoolId?._id || teacher.schoolId;
            const holidayEvents = await (0, holiday_utils_1.findHolidayEventsForClass)({
                schoolId,
                dateKey,
                timezone: schoolTimezone,
                grade: schedule.grade,
                section: schedule.section,
            });
            if (holidayEvents.length) {
                const titles = holidayEvents
                    .map((event) => event.title)
                    .filter((title) => Boolean(title));
                const label = titles.length ? ` (${titles.join(", ")})` : "";
                throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, `Attendance cannot be taken on ${dateKey}; the school calendar marks this date as a holiday${label}.`);
            }
            const existingAttendance = await attendance_model_1.Attendance.findOne({
                teacherId: teacher._id,
                subjectId: new mongoose_1.Types.ObjectId(subjectId),
                classId: new mongoose_1.Types.ObjectId(classId),
                date: attendanceDate,
                period: period,
            });
            const attendanceMap = new Map();
            if (existingAttendance) {
                existingAttendance.students.forEach((student) => {
                    attendanceMap.set(student.studentId.toString(), student.status);
                });
            }
            const studentObjectIds = students.map((student) => student._id);
            const dayAttendanceDocs = await day_attendance_model_1.StudentDayAttendance.find({
                schoolId: teacher.schoolId,
                dateKey,
                studentId: { $in: studentObjectIds },
            }).select("studentId autoStatus teacherStatus finalStatus finalSource teacherOverride autoMarkedAt teacherMarkedAt finalized");
            const dayAttendanceMap = new Map();
            dayAttendanceDocs.forEach((doc) => {
                dayAttendanceMap.set(doc.studentId.toString(), doc);
            });
            const studentsWithAttendance = students.map((student) => ({
                id: student._id.toString(),
                studentId: student.studentId,
                name: `${student.userId.firstName} ${student.userId.lastName}`,
                rollNumber: student.rollNumber,
                grade: student.grade,
                section: student.section,
                autoStatus: dayAttendanceMap.get(student._id.toString())?.autoStatus || null,
                finalStatus: dayAttendanceMap.get(student._id.toString())?.finalStatus || null,
                finalSource: dayAttendanceMap.get(student._id.toString())?.finalSource || null,
                teacherOverride: dayAttendanceMap.get(student._id.toString())?.teacherOverride ||
                    false,
                currentStatus: attendanceMap.get(student._id.toString()) || null,
                hasPhoto: student.photos && student.photos.length > 0,
            }));
            const periodInfo = schedule.periods.find((p) => p.periodNumber === period &&
                p.teacherId?.toString() === teacher._id.toString() &&
                p.subjectId?.toString() === subjectId);
            return {
                classInfo: {
                    id: classId,
                    grade: schedule.grade,
                    section: schedule.section,
                    name: `Grade ${schedule.grade} - Section ${schedule.section}`,
                },
                subjectInfo: periodInfo?.subjectId,
                periodInfo: {
                    number: period,
                    startTime: periodInfo?.startTime || "00:00",
                    endTime: periodInfo?.endTime || "00:00",
                    canMarkAttendance: this.canMarkAttendanceNow(periodInfo?.startTime || "00:00", periodInfo?.endTime || "00:00", now),
                    timeStatus: this.getPeriodTimeStatus(periodInfo?.startTime || "00:00", periodInfo?.endTime || "00:00", now),
                },
                students: studentsWithAttendance,
                attendanceAlreadyMarked: existingAttendance !== null,
                teacherInfo: {
                    id: teacher._id,
                    name: `${teacher.userId.firstName} ${teacher.userId.lastName}`,
                },
                date: dateString,
                dateKey,
            };
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to get students for attendance: ${error.message}`);
        }
    }
    async getMyStudentsForAttendance(userId) {
        try {
            const teacher = await teacher_model_1.Teacher.findOne({ userId }).populate("schoolId userId");
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const now = new Date();
            const currentDay = now
                .toLocaleDateString("en-US", { weekday: "long" })
                .toLowerCase();
            const schedules = await schedule_model_1.Schedule.find({
                schoolId: teacher.schoolId,
                dayOfWeek: currentDay,
                isActive: true,
                "periods.teacherId": teacher._id,
            }).populate("classId");
            const schoolTimezone = teacher.schoolId?.settings?.timezone ||
                config_1.default.school_timezone ||
                "UTC";
            const { dateKey } = (0, day_attendance_model_1.normaliseDateKey)(now, schoolTimezone);
            const schoolId = teacher.schoolId?._id || teacher.schoolId;
            const classesWithStudents = [];
            const holidayClasses = [];
            for (const schedule of schedules) {
                const holidayEvents = await (0, holiday_utils_1.findHolidayEventsForClass)({
                    schoolId,
                    dateKey,
                    timezone: schoolTimezone,
                    grade: schedule.grade,
                    section: schedule.section,
                });
                let students = await student_model_1.Student.find({
                    schoolId: teacher.schoolId,
                    grade: schedule.grade,
                    section: schedule.section,
                    isActive: true,
                }).populate("userId", "firstName lastName profilePhoto");
                const classEntry = {
                    classId: schedule.classId._id,
                    grade: schedule.grade,
                    section: schedule.section,
                    className: `Grade ${schedule.grade} - Section ${schedule.section}`,
                    isHoliday: holidayEvents.length > 0,
                    holidayEvents: holidayEvents.map((event) => ({
                        id: event._id?.toString?.() ?? "",
                        title: event.title,
                        date: event.date,
                    })),
                    students: students.map((student) => ({
                        id: student._id,
                        studentId: student.studentId,
                        rollNumber: student.rollNumber,
                        name: `${student.userId.firstName} ${student.userId.lastName}`,
                        profilePhoto: student.userId.profilePhoto,
                        grade: student.grade,
                        section: student.section,
                    })),
                };
                if (holidayEvents.length) {
                    holidayClasses.push({
                        ...classEntry,
                        students: [],
                    });
                    classEntry.students = [];
                }
                if (classEntry.students.length > 0 || classEntry.isHoliday) {
                    classesWithStudents.push(classEntry);
                }
            }
            const holidayTitles = holidayClasses
                .flatMap((cls) => cls.holidayEvents.map((event) => event.title).filter(Boolean))
                .filter((value, index, array) => value && array.indexOf(value) === index);
            return {
                teacherInfo: {
                    id: teacher._id,
                    name: `${teacher.userId.firstName} ${teacher.userId.lastName}`,
                },
                classes: classesWithStudents,
                holidayClasses,
                holidayNotice: holidayTitles.length
                    ? `Attendance is disabled today due to ${holidayTitles.join(", ")}`
                    : holidayClasses.length
                        ? "Attendance is disabled today due to a school holiday."
                        : null,
                date: now.toISOString().split("T")[0],
            };
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to get students for attendance: ${error.message}`);
        }
    }
    async assignHomework(userId, homeworkData, attachments) {
        try {
            const teacher = await teacher_model_1.Teacher.findOne({ userId }).populate("schoolId");
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            let attachmentUrls = [];
            if (attachments && attachments.length > 0) {
                try {
                    const { uploadToCloudinary } = await Promise.resolve().then(() => __importStar(require("../../utils/cloudinaryUtils")));
                    for (const file of attachments) {
                        const uploadResult = await uploadToCloudinary(file.buffer, {
                            folder: "homework-attachments",
                            resource_type: "auto",
                            use_filename: true,
                            unique_filename: true,
                        });
                        attachmentUrls.push(uploadResult.secure_url);
                    }
                }
                catch (error) {
                    throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, "Failed to upload attachments");
                }
            }
            const { Homework } = await Promise.resolve().then(() => __importStar(require("../homework/homework.model")));
            const homework = new Homework({
                schoolId: teacher.schoolId,
                teacherId: teacher._id,
                subjectId: homeworkData.subjectId,
                grade: parseInt(homeworkData.grade),
                section: homeworkData.section || undefined,
                title: homeworkData.title,
                description: homeworkData.description,
                instructions: homeworkData.instructions,
                homeworkType: homeworkData.homeworkType || "assignment",
                priority: homeworkData.priority || "medium",
                assignedDate: new Date(),
                dueDate: new Date(homeworkData.dueDate),
                estimatedDuration: parseInt(homeworkData.estimatedDuration) || 60,
                totalMarks: parseInt(homeworkData.totalMarks) || 100,
                passingMarks: parseInt(homeworkData.passingMarks) || 40,
                attachments: attachmentUrls,
                submissionType: homeworkData.submissionType || "both",
                allowLateSubmission: homeworkData.allowLateSubmission !== false,
                latePenalty: parseInt(homeworkData.latePenalty) || 10,
                maxLateDays: parseInt(homeworkData.maxLateDays) || 3,
                isGroupWork: homeworkData.isGroupWork === true,
                maxGroupSize: homeworkData.isGroupWork
                    ? parseInt(homeworkData.maxGroupSize) || 4
                    : undefined,
                rubric: homeworkData.rubric || [],
                tags: homeworkData.tags || [],
                isPublished: homeworkData.isPublished === true,
            });
            await homework.save();
            const populatedHomework = await Homework.findById(homework._id)
                .populate({
                path: "teacherId",
                select: "userId teacherId",
                populate: {
                    path: "userId",
                    select: "firstName lastName",
                },
            })
                .populate("subjectId", "name code")
                .populate("schoolId", "name");
            if (homework.isPublished) {
                try {
                    const students = await student_model_1.Student.find({
                        schoolId: teacher.schoolId,
                        grade: homework.grade,
                        ...(homework.section ? { section: homework.section } : {}),
                        isActive: true,
                    });
                    const studentIds = students.map((s) => s._id.toString());
                    if (studentIds.length > 0) {
                        await notification_model_1.Notification.createHomeworkAlert({
                            studentIds: studentIds,
                            teacherId: teacher._id.toString(),
                            homeworkTitle: homework.title,
                            dueDate: homework.dueDate,
                            subjectName: populatedHomework?.subjectId?.name ||
                                "Unknown Subject",
                        });
                    }
                }
                catch (notificationError) {
                    console.error("Failed to send homework notifications:", notificationError);
                }
            }
            return {
                id: homework._id,
                ...populatedHomework?.toJSON(),
                message: "Homework assigned successfully",
            };
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to assign homework: ${error.message}`);
        }
    }
    async getMyHomeworkAssignments(userId, filters) {
        try {
            const teacher = await teacher_model_1.Teacher.findOne({ userId });
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const { Homework } = await Promise.resolve().then(() => __importStar(require("../homework/homework.model")));
            const query = { teacherId: teacher._id };
            if (filters?.grade) {
                query.grade = parseInt(filters.grade);
            }
            if (filters?.section) {
                query.section = filters.section;
            }
            if (filters?.subjectId) {
                query.subjectId = filters.subjectId;
            }
            if (filters?.isPublished !== undefined) {
                query.isPublished = filters.isPublished === "true";
            }
            if (filters?.priority) {
                query.priority = filters.priority;
            }
            if (filters?.homeworkType) {
                query.homeworkType = filters.homeworkType;
            }
            if (filters?.startDate || filters?.endDate) {
                query.dueDate = {};
                if (filters.startDate) {
                    query.dueDate.$gte = new Date(filters.startDate);
                }
                if (filters.endDate) {
                    query.dueDate.$lte = new Date(filters.endDate);
                }
            }
            const assignments = await Homework.find(query)
                .populate({
                path: "teacherId",
                select: "userId teacherId",
                populate: {
                    path: "userId",
                    select: "firstName lastName",
                },
            })
                .populate("subjectId", "name code")
                .populate("schoolId", "name")
                .sort({ updatedAt: -1, createdAt: -1 })
                .lean();
            const assignmentsWithStats = await Promise.all(assignments.map(async (assignment) => {
                const homework = await Homework.findById(assignment._id);
                const stats = homework ? await homework.getSubmissionStats() : null;
                return {
                    ...assignment,
                    submissionStats: stats,
                    isOverdue: homework ? homework.isOverdue() : false,
                    isDueToday: homework ? homework.isDueToday() : false,
                    isDueTomorrow: homework ? homework.isDueTomorrow() : false,
                    daysUntilDue: homework ? homework.getDaysUntilDue() : 0,
                    canSubmit: homework ? homework.canSubmit() : false,
                };
            }));
            const summary = {
                total: assignments.length,
                published: assignments.filter((a) => a.isPublished).length,
                draft: assignments.filter((a) => !a.isPublished).length,
                overdue: assignmentsWithStats.filter((a) => a.isOverdue).length,
                dueToday: assignmentsWithStats.filter((a) => a.isDueToday).length,
                upcoming: assignmentsWithStats.filter((a) => a.daysUntilDue > 0 && a.daysUntilDue <= 7).length,
                byPriority: {
                    urgent: assignments.filter((a) => a.priority === "urgent").length,
                    high: assignments.filter((a) => a.priority === "high").length,
                    medium: assignments.filter((a) => a.priority === "medium").length,
                    low: assignments.filter((a) => a.priority === "low").length,
                },
                byType: {
                    assignment: assignments.filter((a) => a.homeworkType === "assignment")
                        .length,
                    project: assignments.filter((a) => a.homeworkType === "project")
                        .length,
                    reading: assignments.filter((a) => a.homeworkType === "reading")
                        .length,
                    practice: assignments.filter((a) => a.homeworkType === "practice")
                        .length,
                    research: assignments.filter((a) => a.homeworkType === "research")
                        .length,
                    presentation: assignments.filter((a) => a.homeworkType === "presentation").length,
                    other: assignments.filter((a) => a.homeworkType === "other").length,
                },
            };
            return {
                teacherId: teacher._id,
                assignments: assignmentsWithStats,
                summary,
            };
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to get homework assignments: ${error.message}`);
        }
    }
    async issueWarning(userId, warningData) {
        try {
            const teacher = await teacher_model_1.Teacher.findOne({ userId }).populate("schoolId");
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const { DisciplinaryAction } = await Promise.resolve().then(() => __importStar(require("../disciplinary/disciplinary.model")));
            const actions = [];
            for (const studentId of warningData.studentIds) {
                const student = await student_model_1.Student.findById(studentId);
                if (!student ||
                    student.schoolId.toString() !== teacher.schoolId._id.toString()) {
                    throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, `You don't have permission for student ${studentId}`);
                }
                const action = await DisciplinaryAction.create({
                    schoolId: teacher.schoolId._id,
                    studentId,
                    teacherId: teacher._id,
                    actionType: warningData.actionType || "warning",
                    severity: warningData.severity,
                    category: warningData.category,
                    title: warningData.title || warningData.reason,
                    description: warningData.description || warningData.reason,
                    reason: warningData.reason,
                    incidentDate: warningData.incidentDate
                        ? new Date(warningData.incidentDate)
                        : new Date(),
                    actionTaken: warningData.actionTaken,
                    followUpRequired: warningData.followUpRequired || false,
                    followUpDate: warningData.followUpDate
                        ? new Date(warningData.followUpDate)
                        : undefined,
                    isAppealable: warningData.isAppealable !== false,
                    appealDeadline: warningData.appealDeadline
                        ? new Date(warningData.appealDeadline)
                        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    witnesses: warningData.witnesses || [],
                    evidenceAttachments: warningData.evidenceAttachments || [],
                    points: warningData.points ||
                        (warningData.severity === "high"
                            ? 10
                            : warningData.severity === "medium"
                                ? 5
                                : 2),
                    warrantLevel: warningData.warrantLevel,
                    isRedWarrant: warningData.actionType === "red_warrant",
                    academicYear: new Date().getFullYear() + "-" + (new Date().getFullYear() + 1),
                    createdBy: teacher.userId,
                });
                if (warningData.notifyParents) {
                    try {
                        await action.notifyParents();
                    }
                    catch (error) {
                        console.error("Failed to notify parents:", error);
                    }
                }
                try {
                    await action.notifyStudent();
                }
                catch (error) {
                    console.error("Failed to notify student:", error);
                }
                actions.push(action);
            }
            return {
                success: true,
                actionsCreated: actions.length,
                actions: actions.map((action) => ({
                    id: action._id?.toString() || action.id,
                    studentId: action.studentId,
                    actionType: action.actionType,
                    severity: action.severity,
                    title: action.title,
                    isRedWarrant: action.isRedWarrant,
                    issuedAt: action.issuedDate,
                })),
                teacherId: teacher._id,
            };
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to issue warning: ${error.message}`);
        }
    }
    async issuePunishment(userId, punishmentData) {
        try {
            const teacher = await teacher_model_1.Teacher.findOne({ userId }).populate("schoolId");
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const { DisciplinaryAction } = await Promise.resolve().then(() => __importStar(require("../disciplinary/disciplinary.model")));
            const actions = [];
            for (const studentId of punishmentData.studentIds) {
                const student = await student_model_1.Student.findById(studentId);
                if (!student ||
                    student.schoolId.toString() !== teacher.schoolId._id.toString()) {
                    throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, `You don't have permission for student ${studentId}`);
                }
                if (!punishmentData.reason || punishmentData.reason.trim() === "") {
                    throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Reason is required for disciplinary action");
                }
                const action = await DisciplinaryAction.create({
                    schoolId: teacher.schoolId._id,
                    studentId,
                    teacherId: teacher._id,
                    actionType: "red_warrant",
                    severity: punishmentData.severity || "high",
                    category: punishmentData.category || "discipline",
                    title: `RED WARRANT: ${punishmentData.title}`,
                    description: punishmentData.description,
                    reason: punishmentData.reason.trim(),
                    incidentDate: punishmentData.incidentDate
                        ? new Date(punishmentData.incidentDate)
                        : new Date(),
                    actionTaken: punishmentData.actionTaken,
                    followUpRequired: true,
                    followUpDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
                    isAppealable: punishmentData.isAppealable !== false,
                    appealDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    witnesses: punishmentData.witnesses || [],
                    evidenceAttachments: punishmentData.evidenceAttachments || [],
                    points: punishmentData.severity === "critical" ? 50 : 30,
                    warrantLevel: "red",
                    isRedWarrant: true,
                    academicYear: new Date().getFullYear() + "-" + (new Date().getFullYear() + 1),
                    createdBy: teacher.userId,
                });
                try {
                    await action.notifyParents();
                    await action.notifyStudent();
                }
                catch (error) {
                    console.error("Failed to send notifications:", error);
                }
                actions.push(action);
            }
            return {
                success: true,
                redWarrantsIssued: actions.length,
                actions: actions.map((action) => ({
                    id: action._id?.toString() || action.id,
                    studentId: action.studentId,
                    warrantNumber: `RW-${Date.now()}-${(action._id?.toString() || "")
                        .slice(-6)
                        .toUpperCase()}`,
                    severity: action.severity,
                    title: action.title,
                    issuedAt: action.issuedDate,
                })),
                teacherId: teacher._id,
                urgentNotificationsSent: true,
            };
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to issue punishment: ${error.message}`);
        }
    }
    async getMyDisciplinaryActions(userId, filters) {
        try {
            const teacher = await teacher_model_1.Teacher.findOne({ userId });
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const { DisciplinaryAction } = await Promise.resolve().then(() => __importStar(require("../disciplinary/disciplinary.model")));
            const query = { teacherId: teacher._id };
            if (filters?.actionType)
                query.actionType = filters.actionType;
            if (filters?.severity)
                query.severity = filters.severity;
            if (filters?.status)
                query.status = filters.status;
            if (filters?.isRedWarrant !== undefined)
                query.isRedWarrant = filters.isRedWarrant === "true";
            const actions = await DisciplinaryAction.find(query)
                .populate({
                path: "studentId",
                select: "userId rollNumber grade section",
                populate: {
                    path: "userId",
                    select: "firstName lastName",
                },
            })
                .sort({ issuedDate: -1 });
            const stats = await DisciplinaryAction.getDisciplinaryStats(teacher.schoolId.toString(), { teacherId: teacher._id });
            return {
                teacherId: teacher._id,
                actions: actions.map((action) => {
                    const student = action.studentId;
                    const user = student?.userId;
                    return {
                        id: action._id,
                        studentName: user ? `${user.firstName} ${user.lastName}` : "N/A",
                        studentRoll: student?.rollNumber || "N/A",
                        grade: student?.grade || "N/A",
                        section: student?.section || "N/A",
                        actionType: action.actionType,
                        severity: action.severity,
                        category: action.category,
                        title: action.title,
                        description: action.description,
                        reason: action.reason,
                        status: action.status,
                        issuedDate: action.issuedDate,
                        isRedWarrant: action.isRedWarrant,
                        warrantLevel: action.warrantLevel,
                        parentNotified: action.parentNotified,
                        studentAcknowledged: action.studentAcknowledged,
                        followUpRequired: action.followUpRequired,
                        followUpDate: action.followUpDate,
                        canAppeal: action.canAppeal
                            ? action.canAppeal()
                            : false,
                        isOverdue: action.isOverdue
                            ? action.isOverdue()
                            : false,
                    };
                }),
                stats,
            };
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to get disciplinary actions: ${error.message}`);
        }
    }
    async resolveDisciplinaryAction(userId, actionId, resolutionNotes) {
        try {
            const teacher = await teacher_model_1.Teacher.findOne({ userId });
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const { DisciplinaryAction } = await Promise.resolve().then(() => __importStar(require("../disciplinary/disciplinary.model")));
            const action = await DisciplinaryAction.findById(actionId);
            if (!action) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Disciplinary action not found");
            }
            if (action.teacherId.toString() !== teacher._id.toString()) {
                throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, "You can only resolve your own disciplinary actions");
            }
            action.status = "resolved";
            action.resolvedDate = new Date();
            action.resolvedBy = teacher.userId;
            action.resolutionNotes = resolutionNotes;
            const resolvedAction = await action.save();
            return {
                id: resolvedAction._id,
                status: resolvedAction.status,
                resolvedDate: resolvedAction.resolvedDate,
                resolutionNotes: resolvedAction.resolutionNotes,
            };
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to resolve disciplinary action: ${error.message}`);
        }
    }
    async addDisciplinaryActionComment(userId, actionId, comment) {
        try {
            const teacher = await teacher_model_1.Teacher.findOne({ userId });
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const { DisciplinaryAction } = await Promise.resolve().then(() => __importStar(require("../disciplinary/disciplinary.model")));
            const action = await DisciplinaryAction.findById(actionId);
            if (!action) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Disciplinary action not found");
            }
            if (action.teacherId.toString() !== teacher._id.toString()) {
                throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, "You can only comment on your own disciplinary actions");
            }
            action.resolutionNotes =
                (action.resolutionNotes || "") + "\n\nFollow-up: " + comment;
            action.followUpDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
            const updatedAction = await action.save();
            return {
                id: updatedAction._id,
                followUpDate: updatedAction.followUpDate,
                resolutionNotes: updatedAction.resolutionNotes,
            };
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to add comment to disciplinary action: ${error.message}`);
        }
    }
    async getStudentsByGrade(userId, grade, section) {
        try {
            const teacher = await teacher_model_1.Teacher.findOne({ userId }).populate("schoolId");
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const teacherSchedules = await schedule_model_1.Schedule.find({
                schoolId: teacher.schoolId,
                "periods.teacherId": teacher._id,
                isActive: true,
            });
            const teacherGrades = new Set([
                ...teacher.grades,
                ...teacherSchedules.map((s) => s.grade),
            ]);
            const hasGeneralAccess = teacher.designation === "head_teacher" ||
                teacher.designation === "assistant_head_teacher" ||
                teacher.designation === "discipline_master" ||
                teacherGrades.size > 0;
            if (!teacherGrades.has(grade) && !hasGeneralAccess) {
                throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, `You don't have permission to access Grade ${grade}`);
            }
            const query = {
                schoolId: teacher.schoolId._id,
                grade,
                isActive: true,
            };
            if (section) {
                if (!teacher.sections.includes(section)) {
                    throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, `You don't have permission to access Section ${section}`);
                }
                query.section = section;
            }
            const students = await student_model_1.Student.find(query)
                .populate("userId", "firstName lastName email phone")
                .populate({
                path: "parentId",
                select: "userId",
                populate: {
                    path: "userId",
                    select: "firstName lastName email phone",
                },
            })
                .sort({ rollNumber: 1 });
            const { DisciplinaryAction } = await Promise.resolve().then(() => __importStar(require("../disciplinary/disciplinary.model")));
            const studentsWithStats = await Promise.all(students.map(async (student) => {
                const disciplinaryHistory = await DisciplinaryAction.getStudentDisciplinaryHistory(student._id.toString());
                const user = student.userId;
                const parent = student.parentId;
                const parentUser = parent?.userId;
                return {
                    id: student._id,
                    studentId: student.studentId,
                    name: user ? `${user.firstName} ${user.lastName}` : "N/A",
                    email: user?.email || "N/A",
                    phone: user?.phone || "N/A",
                    rollNumber: student.rollNumber,
                    grade: student.grade,
                    section: student.section,
                    admissionDate: student.admissionDate,
                    bloodGroup: student.bloodGroup,
                    parentInfo: parent
                        ? {
                            name: parentUser
                                ? `${parentUser.firstName} ${parentUser.lastName}`
                                : "N/A",
                            email: parentUser?.email || "N/A",
                            phone: parentUser?.phone || "N/A",
                        }
                        : null,
                    disciplinaryHistory: {
                        totalActions: disciplinaryHistory.totalActions,
                        activeWarnings: disciplinaryHistory.activeActions,
                        totalPoints: disciplinaryHistory.totalPoints,
                        redWarrants: disciplinaryHistory.redWarrants,
                        lastActionDate: disciplinaryHistory.recentActions[0]?.issuedDate || null,
                        riskLevel: disciplinaryHistory.totalPoints > 40
                            ? "high"
                            : disciplinaryHistory.totalPoints > 20
                                ? "medium"
                                : "low",
                    },
                    hasPhotos: false,
                };
            }));
            const classStats = {
                totalStudents: students.length,
                studentsWithDisciplinaryActions: studentsWithStats.filter((s) => s.disciplinaryHistory.totalActions > 0).length,
                studentsWithActiveWarnings: studentsWithStats.filter((s) => s.disciplinaryHistory.activeWarnings > 0).length,
                studentsWithRedWarrants: studentsWithStats.filter((s) => s.disciplinaryHistory.redWarrants > 0).length,
                highRiskStudents: studentsWithStats.filter((s) => s.disciplinaryHistory.riskLevel === "high").length,
                averageDisciplinaryPoints: studentsWithStats.reduce((sum, s) => sum + s.disciplinaryHistory.totalPoints, 0) / students.length,
            };
            return {
                teacherInfo: {
                    id: teacher._id,
                    teacherId: teacher.teacherId,
                    name: teacher.userId
                        ? `${teacher.userId.firstName} ${teacher.userId.lastName}`
                        : "N/A",
                    subjects: teacher.subjects,
                    grades: teacher.grades,
                    sections: teacher.sections,
                },
                classInfo: {
                    grade,
                    section: section || "All Sections",
                    className: section
                        ? `Grade ${grade} - Section ${section}`
                        : `Grade ${grade} - All Sections`,
                },
                students: studentsWithStats,
                stats: classStats,
                canIssueDisciplinaryActions: true,
                canViewDetailedRecords: true,
            };
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to get students by grade: ${error.message}`);
        }
    }
    async getMyGradingTasks(userId) {
        try {
            const teacher = await teacher_model_1.Teacher.findOne({ userId }).populate("schoolId");
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const now = new Date();
            const currentAcademicYear = `${now.getFullYear()}-${now.getFullYear() + 1}`;
            const { Exam } = await Promise.resolve().then(() => __importStar(require("../exam/exam.model")));
            const { AcademicCalendar } = await Promise.resolve().then(() => __importStar(require("../academic-calendar/academic-calendar.model")));
            const { Grade } = await Promise.resolve().then(() => __importStar(require("../grade/grade.model")));
            const academicExams = [];
            const regularExams = await Exam.find({
                schoolId: teacher.schoolId._id,
                teacherId: teacher._id,
                academicYear: currentAcademicYear,
                examDate: { $lte: now },
                status: { $in: ["completed", "grading"] },
            }).populate("subjectId", "name code");
            const gradingTasks = [];
            for (const exam of regularExams) {
                const existingGrades = await Grade.countDocuments({
                    teacherId: teacher._id,
                    subjectId: exam.subjectId,
                    gradeType: "exam",
                    title: exam.examName,
                    academicYear: currentAcademicYear,
                });
                const studentsQuery = {
                    schoolId: teacher.schoolId._id,
                    grade: exam.grade,
                    isActive: true,
                };
                if (exam.section) {
                    studentsQuery.section = exam.section;
                }
                const students = await student_model_1.Student.countDocuments(studentsQuery);
                const pendingGrades = students - existingGrades;
                if (pendingGrades > 0) {
                    gradingTasks.push({
                        id: exam._id.toString(),
                        examId: exam._id,
                        examName: exam.examName,
                        examType: exam.examType,
                        subject: exam.subjectId,
                        grade: exam.grade,
                        section: exam.section,
                        examDate: exam.examDate,
                        totalMarks: exam.totalMarks,
                        passingMarks: exam.passingMarks,
                        duration: exam.duration,
                        totalStudents: students,
                        gradedStudents: existingGrades,
                        pendingGrades,
                        gradingStatus: existingGrades === 0
                            ? "not_started"
                            : pendingGrades === 0
                                ? "completed"
                                : "in_progress",
                        deadline: new Date(exam.examDate.getTime() + 7 * 24 * 60 * 60 * 1000),
                        isOverdue: now > new Date(exam.examDate.getTime() + 7 * 24 * 60 * 60 * 1000),
                        priority: now > new Date(exam.examDate.getTime() + 5 * 24 * 60 * 60 * 1000)
                            ? "high"
                            : "medium",
                        source: "exam",
                        canGrade: true,
                    });
                }
            }
            gradingTasks.sort((a, b) => {
                if (a.priority === "high" && b.priority !== "high")
                    return -1;
                if (b.priority === "high" && a.priority !== "high")
                    return 1;
                return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
            });
            const stats = {
                totalTasks: gradingTasks.length,
                notStarted: gradingTasks.filter((t) => t.gradingStatus === "not_started").length,
                inProgress: gradingTasks.filter((t) => t.gradingStatus === "in_progress").length,
                completed: gradingTasks.filter((t) => t.gradingStatus === "completed")
                    .length,
                overdue: gradingTasks.filter((t) => t.isOverdue).length,
                highPriority: gradingTasks.filter((t) => t.priority === "high").length,
                totalPendingGrades: gradingTasks.reduce((sum, t) => sum + t.pendingGrades, 0),
            };
            return {
                teacherId: teacher._id,
                gradingTasks,
                stats,
                academicYear: currentAcademicYear,
                lastUpdated: now.toISOString(),
            };
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to get grading tasks: ${error.message}`);
        }
    }
    async getExamGradingDetails(userId, examId, examItemId) {
        try {
            const teacher = await teacher_model_1.Teacher.findOne({ userId }).populate("schoolId");
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            let examDetails;
            let studentsQuery;
            let subjectInfo;
            if (examItemId) {
                throw new AppError_1.AppError(http_status_1.default.NOT_IMPLEMENTED, "Academic calendar exam grading temporarily disabled");
            }
            else {
                const { Exam } = await Promise.resolve().then(() => __importStar(require("../exam/exam.model")));
                const exam = await Exam.findById(examId).populate("subjectId");
                if (!exam || exam.teacherId?.toString() !== teacher._id.toString()) {
                    throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, "You are not assigned to grade this exam");
                }
                examDetails = {
                    examId,
                    examName: exam.examName,
                    examType: exam.examType,
                    grade: exam.grade,
                    section: exam.section,
                    examDate: exam.examDate,
                    totalMarks: exam.totalMarks,
                    passingMarks: exam.passingMarks,
                    duration: exam.duration,
                    subject: exam.subjectId,
                };
                studentsQuery = {
                    schoolId: teacher.schoolId._id,
                    grade: exam.grade,
                    isActive: true,
                };
                if (exam.section) {
                    studentsQuery.section = exam.section;
                }
                subjectInfo = exam.subjectId;
            }
            const students = await student_model_1.Student.find(studentsQuery)
                .populate("userId", "firstName lastName")
                .sort({ rollNumber: 1 });
            const { Grade } = await Promise.resolve().then(() => __importStar(require("../grade/grade.model")));
            const existingGrades = await Grade.find({
                teacherId: teacher._id,
                subjectId: subjectInfo._id || subjectInfo,
                gradeType: "exam",
                title: examDetails.examName,
                academicYear: new Date().getFullYear() + "-" + (new Date().getFullYear() + 1),
            });
            const gradeMap = new Map();
            existingGrades.forEach((grade) => {
                gradeMap.set(grade.studentId.toString(), {
                    marksObtained: grade.marksObtained,
                    percentage: grade.percentage,
                    grade: grade.grade,
                    remarks: grade.description,
                    gradedDate: grade.gradedDate,
                });
            });
            const studentsForGrading = students.map((student) => {
                const existingGrade = gradeMap.get(student._id.toString());
                const user = student.userId;
                return {
                    id: student._id,
                    studentId: student.studentId,
                    name: user ? `${user.firstName} ${user.lastName}` : "N/A",
                    rollNumber: student.rollNumber,
                    grade: examDetails.grade,
                    section: student.section,
                    currentGrade: existingGrade || null,
                    isGraded: !!existingGrade,
                };
            });
            const gradingStats = {
                totalStudents: students.length,
                gradedStudents: existingGrades.length,
                pendingGrades: students.length - existingGrades.length,
                averageMarks: existingGrades.length > 0
                    ? existingGrades.reduce((sum, g) => sum + g.marksObtained, 0) /
                        existingGrades.length
                    : 0,
                passedStudents: existingGrades.filter((g) => g.percentage >=
                    (examDetails.passingMarks / examDetails.totalMarks) * 100).length,
                failedStudents: existingGrades.filter((g) => g.percentage <
                    (examDetails.passingMarks / examDetails.totalMarks) * 100).length,
            };
            return {
                examDetails: {
                    ...examDetails,
                    subject: {
                        id: subjectInfo._id || subjectInfo,
                        name: subjectInfo.name || "Unknown Subject",
                        code: subjectInfo.code || "N/A",
                    },
                },
                students: studentsForGrading,
                gradingStats,
                gradingScale: {
                    A: `${Math.ceil((examDetails.passingMarks / examDetails.totalMarks) * 100) + 20}-100`,
                    B: `${Math.ceil((examDetails.passingMarks / examDetails.totalMarks) * 100) + 10}-${Math.ceil((examDetails.passingMarks / examDetails.totalMarks) * 100) + 19}`,
                    C: `${Math.ceil((examDetails.passingMarks / examDetails.totalMarks) * 100)}-${Math.ceil((examDetails.passingMarks / examDetails.totalMarks) * 100) + 9}`,
                    D: `${Math.ceil((examDetails.passingMarks / examDetails.totalMarks) * 100) - 10}-${Math.ceil((examDetails.passingMarks / examDetails.totalMarks) * 100) - 1}`,
                    F: `0-${Math.ceil((examDetails.passingMarks / examDetails.totalMarks) * 100) - 11}`,
                },
                canSubmitGrades: true,
            };
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to get exam grading details: ${error.message}`);
        }
    }
    async submitGrades(userId, gradesData) {
        try {
            const teacher = await teacher_model_1.Teacher.findOne({ userId });
            if (!teacher) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Teacher not found");
            }
            const { Grade } = await Promise.resolve().then(() => __importStar(require("../grade/grade.model")));
            const currentAcademicYear = new Date().getFullYear() + "-" + (new Date().getFullYear() + 1);
            const { examId, examItemId, examName, subjectId, grades } = gradesData;
            if (examItemId) {
            }
            else {
                const { Exam } = await Promise.resolve().then(() => __importStar(require("../exam/exam.model")));
                const exam = await Exam.findById(examId);
                if (!exam || exam.teacherId?.toString() !== teacher._id.toString()) {
                    throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, "You are not assigned to grade this exam");
                }
            }
            const submittedGrades = [];
            const errors = [];
            for (const gradeData of grades) {
                try {
                    const existingGrade = await Grade.findOne({
                        studentId: gradeData.studentId,
                        teacherId: teacher._id,
                        subjectId,
                        gradeType: "exam",
                        title: examName,
                        academicYear: currentAcademicYear,
                    });
                    const gradeInfo = {
                        schoolId: teacher.schoolId,
                        studentId: gradeData.studentId,
                        teacherId: teacher._id,
                        subjectId,
                        academicYear: currentAcademicYear,
                        semester: gradeData.semester || "first",
                        gradeType: "exam",
                        title: examName,
                        description: gradeData.remarks || "",
                        marksObtained: gradeData.obtainedMarks,
                        totalMarks: gradeData.totalMarks || 100,
                        percentage: gradeData.percentage ||
                            (gradeData.obtainedMarks / (gradeData.totalMarks || 100)) * 100,
                        grade: gradeData.grade,
                        weightage: gradeData.weightage || 100,
                        gradedDate: new Date(),
                    };
                    if (existingGrade) {
                        Object.assign(existingGrade, gradeInfo);
                        await existingGrade.save();
                        submittedGrades.push({
                            studentId: gradeData.studentId,
                            action: "updated",
                            gradeId: existingGrade._id,
                        });
                    }
                    else {
                        const newGrade = await Grade.create(gradeInfo);
                        submittedGrades.push({
                            studentId: gradeData.studentId,
                            action: "created",
                            gradeId: newGrade._id,
                        });
                    }
                    try {
                        const { Notification } = await Promise.resolve().then(() => __importStar(require("../notification/notification.model")));
                        const student = await student_model_1.Student.findById(gradeData.studentId).populate([
                            { path: "userId", select: "firstName lastName" },
                            {
                                path: "parentId",
                                select: "userId",
                                populate: { path: "userId", select: "_id" },
                            },
                        ]);
                        if (student) {
                            const studentUser = student.userId;
                            const parentInfo = student.parentId;
                            const parentUser = parentInfo?.userId;
                            await Notification.create({
                                schoolId: teacher.schoolId,
                                recipientId: studentUser._id,
                                recipientType: "student",
                                senderId: teacher.userId,
                                senderType: "teacher",
                                type: "grade_published",
                                title: `Grade Published: ${examName}`,
                                message: `Your exam grade has been published for ${examName}. Marks: ${gradeData.obtainedMarks}/${gradeData.totalMarks || 100} (${gradeData.grade})`,
                                priority: "medium",
                                relatedEntityId: examId,
                                relatedEntityType: "exam",
                                metadata: {
                                    subjectName: gradeData.subjectName || "Unknown Subject",
                                    examName,
                                    marks: gradeData.obtainedMarks,
                                    totalMarks: gradeData.totalMarks || 100,
                                    grade: gradeData.grade,
                                    percentage: gradeData.percentage,
                                },
                            });
                            if (parentInfo && parentUser) {
                                await Notification.create({
                                    schoolId: teacher.schoolId,
                                    recipientId: parentUser._id,
                                    recipientType: "parent",
                                    senderId: teacher.userId,
                                    senderType: "teacher",
                                    type: "grade_published",
                                    title: `Grade Published: ${studentUser.firstName}'s ${examName}`,
                                    message: `${studentUser.firstName}'s exam grade has been published for ${examName}. Marks: ${gradeData.obtainedMarks}/${gradeData.totalMarks || 100} (${gradeData.grade})`,
                                    priority: "medium",
                                    relatedEntityId: examId,
                                    relatedEntityType: "exam",
                                    metadata: {
                                        studentName: `${studentUser.firstName} ${studentUser.lastName}`,
                                        subjectName: gradeData.subjectName || "Unknown Subject",
                                        examName,
                                        marks: gradeData.obtainedMarks,
                                        totalMarks: gradeData.totalMarks || 100,
                                        grade: gradeData.grade,
                                        percentage: gradeData.percentage,
                                    },
                                });
                            }
                        }
                    }
                    catch (notificationError) {
                        console.error("Failed to send grade notification:", notificationError);
                    }
                }
                catch (error) {
                    errors.push({
                        studentId: gradeData.studentId,
                        error: error.message,
                    });
                }
            }
            const stats = {
                totalSubmissions: grades.length,
                successful: submittedGrades.length,
                failed: errors.length,
                updated: submittedGrades.filter((g) => g.action === "updated").length,
                created: submittedGrades.filter((g) => g.action === "created").length,
            };
            return {
                success: errors.length === 0,
                submittedAt: new Date().toISOString(),
                teacherId: teacher._id,
                examId,
                examItemId,
                examName,
                subjectId,
                stats,
                submittedGrades,
                errors,
                message: errors.length === 0
                    ? `Successfully submitted grades for ${stats.successful} students`
                    : `Submitted ${stats.successful} grades with ${stats.failed} errors`,
            };
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to submit grades: ${error.message}`);
        }
    }
}
exports.teacherService = new TeacherService();
//# sourceMappingURL=teacher.service.js.map