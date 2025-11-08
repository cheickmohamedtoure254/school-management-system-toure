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
exports.studentService = void 0;
const http_status_1 = __importDefault(require("http-status"));
const mongoose_1 = __importStar(require("mongoose"));
const AppError_1 = require("../../errors/AppError");
const school_model_1 = require("../school/school.model");
const user_model_1 = require("../user/user.model");
const parent_model_1 = require("../parent/parent.model");
const student_model_1 = require("./student.model");
const attendance_model_1 = require("../attendance/attendance.model");
const day_attendance_model_1 = require("../attendance/day-attendance.model");
const assessment_model_1 = require("../assessment/assessment.model");
const assessment_service_1 = require("../assessment/assessment.service");
const homework_model_1 = require("../homework/homework.model");
const schedule_model_1 = require("../schedule/schedule.model");
const academic_calendar_model_1 = require("../academic-calendar/academic-calendar.model");
const userCredentials_model_1 = require("../user/userCredentials.model");
const fileUtils_1 = require("../../utils/fileUtils");
const credentialGenerator_1 = require("../../utils/credentialGenerator");
const cloudinaryUtils_1 = require("../../utils/cloudinaryUtils");
const config_1 = __importDefault(require("../../config"));
class StudentService {
    deriveGradeLetter(percentage) {
        if (percentage >= 90)
            return "A+";
        if (percentage >= 80)
            return "A";
        if (percentage >= 70)
            return "B+";
        if (percentage >= 60)
            return "B";
        if (percentage >= 50)
            return "C";
        if (percentage >= 40)
            return "D";
        return "F";
    }
    getEventColor(eventType) {
        switch (eventType) {
            case "exam":
                return "#ef4444";
            case "holiday":
                return "#10b981";
            case "meeting":
                return "#3b82f6";
            case "academic":
                return "#6366f1";
            case "extracurricular":
                return "#8b5cf6";
            case "administrative":
                return "#6b7280";
            case "announcement":
                return "#f59e0b";
            case "homework":
                return "#f97316";
            default:
                return "#6b7280";
        }
    }
    async createStudent(studentData, photos, adminUserId) {
        const session = await mongoose_1.default.startSession();
        const uploadedPublicIds = [];
        let storedCredentialIds = [];
        let schoolDoc = null;
        let studentDoc = null;
        let studentUserDoc = null;
        let parentUserDocs = [];
        let createdParentDoc = null;
        let existingParentDoc = null;
        let parentWasExisting = false;
        let credentials = undefined;
        if (!photos || photos.length === 0) {
            throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Photos are required for student registration. Please upload at least 3 photos.");
        }
        if (photos.length < 3) {
            throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Minimum 3 photos required for student registration");
        }
        if (photos.length > 8) {
            throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Maximum 8 photos allowed per student");
        }
        for (const photo of photos) {
            if (!photo.mimetype || !photo.originalname) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid photo file. Each photo must have mimetype and original filename.");
            }
            if (!photo.mimetype.startsWith("image/")) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Only image files are allowed for student photos");
            }
        }
        try {
            session.startTransaction();
            schoolDoc = await school_model_1.School.findById(studentData.schoolId).session(session);
            if (!schoolDoc) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "School not found");
            }
            if (schoolDoc.status !== "active") {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Cannot create student for inactive school");
            }
            const existingUser = await user_model_1.User.findOne({
                schoolId: studentData.schoolId,
                firstName: { $regex: new RegExp(`^${studentData.firstName}$`, "i") },
                lastName: { $regex: new RegExp(`^${studentData.lastName}$`, "i") },
                role: "student",
            });
            if (existingUser) {
                const existingStudent = await student_model_1.Student.findOne({
                    userId: existingUser._id,
                    grade: studentData.grade,
                    section: studentData.section,
                });
                if (existingStudent) {
                    throw new AppError_1.AppError(http_status_1.default.CONFLICT, `Student with name '${studentData.firstName} ${studentData.lastName}' already exists in Grade ${studentData.grade} Section ${studentData.section}`);
                }
            }
            const admissionDate = studentData.admissionDate || new Date().toISOString().split("T")[0];
            const admissionYear = new Date(admissionDate).getFullYear();
            let studentId = undefined;
            let rollNumber = undefined;
            let userCreationAttempts = 0;
            const maxUserCreationAttempts = 3;
            let newUser;
            while (userCreationAttempts < maxUserCreationAttempts) {
                try {
                    userCreationAttempts++;
                    const registration = await credentialGenerator_1.CredentialGenerator.generateStudentRegistration(admissionYear, studentData.grade.toString(), studentData.schoolId);
                    studentId = registration.studentId;
                    rollNumber = registration.rollNumber;
                    credentials = registration.credentials;
                    newUser = await user_model_1.User.create([
                        {
                            schoolId: studentData.schoolId,
                            role: "student",
                            username: credentials.student.username,
                            passwordHash: credentials.student.hashedPassword,
                            displayPassword: credentials.student.password,
                            firstName: studentData.firstName,
                            lastName: studentData.lastName,
                            email: studentData.email,
                            phone: studentData.phone,
                        },
                    ], { session });
                    break;
                }
                catch (error) {
                    if (error.code === 11000 &&
                        userCreationAttempts < maxUserCreationAttempts) {
                        await new Promise((resolve) => setTimeout(resolve, Math.random() * 200 + 100));
                        continue;
                    }
                    else {
                        throw error;
                    }
                }
            }
            if (!newUser) {
                throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to create student user after ${maxUserCreationAttempts} attempts. Please try again.`);
            }
            if (!studentId || !credentials || rollNumber === undefined) {
                throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, "Failed to generate student credentials. Please try again.");
            }
            const newStudent = await student_model_1.Student.create([
                {
                    userId: newUser[0]._id,
                    schoolId: studentData.schoolId,
                    studentId,
                    grade: studentData.grade,
                    section: studentData.section,
                    bloodGroup: studentData.bloodGroup,
                    dob: new Date(studentData.dob),
                    admissionDate: studentData.admissionDate
                        ? new Date(studentData.admissionDate)
                        : new Date(),
                    admissionYear,
                    rollNumber: rollNumber,
                    address: studentData.address || {},
                },
            ], { session });
            parentUserDocs = [];
            if (studentData.parentInfo) {
                const { parentInfo } = studentData;
                let existingParent = null;
                if (parentInfo.email) {
                    const existingUser = await user_model_1.User.findOne({
                        email: parentInfo.email,
                        role: "parent",
                        schoolId: studentData.schoolId,
                    }).session(session);
                    if (existingUser) {
                        existingParent = await parent_model_1.Parent.findOne({
                            userId: existingUser._id,
                            schoolId: studentData.schoolId,
                        }).session(session);
                    }
                }
                if (existingParent) {
                    existingParentDoc = existingParent;
                    parentWasExisting = true;
                    if (!existingParent.children.includes(newStudent[0]._id)) {
                        existingParent.children.push(newStudent[0]._id);
                        await existingParent.save({ session });
                    }
                    newStudent[0].parentId = existingParent._id;
                    await newStudent[0].save({ session });
                    const existingParentUser = await user_model_1.User.findById(existingParent.userId).session(session);
                    if (existingParentUser) {
                        parentUserDocs = [existingParentUser];
                    }
                }
                else {
                    parentWasExisting = false;
                    if (!credentials) {
                        throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, "Failed to generate credentials");
                    }
                    parentUserDocs = await user_model_1.User.create([
                        {
                            schoolId: studentData.schoolId,
                            role: "parent",
                            username: credentials.parent.username,
                            passwordHash: credentials.parent.hashedPassword,
                            displayPassword: credentials.parent.password,
                            firstName: parentInfo.name.split(" ")[0] || parentInfo.name,
                            lastName: parentInfo.name.split(" ").slice(1).join(" ") || "Guardian",
                            phone: parentInfo.phone,
                            email: parentInfo.email,
                        },
                    ], { session });
                    let parentId = "";
                    let attempts = 0;
                    const maxAttempts = 5;
                    do {
                        try {
                            parentId = await parent_model_1.Parent.generateNextParentId(studentData.schoolId, undefined, session);
                            const existingParentCheck = await parent_model_1.Parent.findOne({
                                parentId,
                            }).session(session);
                            if (!existingParentCheck) {
                                break;
                            }
                            attempts++;
                            if (attempts >= maxAttempts) {
                                parentId = `PAR-${new Date().getFullYear()}-${Date.now()
                                    .toString()
                                    .slice(-6)}`;
                                break;
                            }
                            await new Promise((resolve) => setTimeout(resolve, 10));
                        }
                        catch (error) {
                            attempts++;
                            if (attempts >= maxAttempts) {
                                throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, "Failed to generate unique parent ID after multiple attempts");
                            }
                        }
                    } while (attempts < maxAttempts);
                    let newParent;
                    try {
                        newParent = await parent_model_1.Parent.create([
                            {
                                userId: parentUserDocs[0]._id,
                                schoolId: studentData.schoolId,
                                parentId: parentId,
                                children: [newStudent[0]._id],
                                relationship: parentInfo.relationship || "Guardian",
                                address: {
                                    street: parentInfo.address || "",
                                    city: "",
                                    state: "",
                                    zipCode: "",
                                    country: "",
                                },
                                preferences: {
                                    communicationMethod: "All",
                                    receiveNewsletters: true,
                                    receiveAttendanceAlerts: true,
                                    receiveExamResults: true,
                                    receiveEventNotifications: true,
                                },
                                occupation: parentInfo.occupation || "",
                            },
                        ], { session });
                    }
                    catch (parentError) {
                        if (parentError.code === 11000 &&
                            parentError.keyPattern?.parentId) {
                            console.warn("Duplicate parent ID detected, retrying with timestamp-based ID");
                            parentId = `PAR-${new Date().getFullYear()}-${Date.now()
                                .toString()
                                .slice(-6)}`;
                            newParent = await parent_model_1.Parent.create([
                                {
                                    userId: parentUserDocs[0]._id,
                                    schoolId: studentData.schoolId,
                                    parentId: parentId,
                                    children: [newStudent[0]._id],
                                    relationship: parentInfo.relationship || "Guardian",
                                    address: {
                                        street: parentInfo.address || "",
                                        city: "",
                                        state: "",
                                        zipCode: "",
                                        country: "",
                                    },
                                    preferences: {
                                        communicationMethod: "All",
                                        receiveNewsletters: true,
                                        receiveAttendanceAlerts: true,
                                        receiveExamResults: true,
                                        receiveEventNotifications: true,
                                    },
                                    occupation: parentInfo.occupation || "",
                                },
                            ], { session });
                        }
                        else {
                            throw parentError;
                        }
                    }
                    newStudent[0].parentId = newParent[0]._id;
                    await newStudent[0].save({ session });
                    createdParentDoc = newParent[0];
                }
            }
            if (adminUserId) {
                if (!credentials) {
                    throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, "Credentials are required for storage");
                }
                const credentialsToStore = [
                    {
                        userId: newUser[0]._id,
                        schoolId: studentData.schoolId,
                        initialUsername: credentials.student.username,
                        initialPassword: credentials.student.password,
                        hasChangedPassword: false,
                        role: "student",
                        issuedBy: new mongoose_1.Types.ObjectId(adminUserId),
                    },
                ];
                if (parentUserDocs && parentUserDocs.length > 0) {
                    const existingParentCredentialsForStudent = await userCredentials_model_1.UserCredentials.findOne({
                        userId: parentUserDocs[0]._id,
                        role: "parent",
                        associatedStudentId: newStudent[0]._id,
                    }).session(session);
                    if (!existingParentCredentialsForStudent) {
                        const existingParentCredentials = await userCredentials_model_1.UserCredentials.findOne({
                            userId: parentUserDocs[0]._id,
                            role: "parent",
                        }).session(session);
                        if (existingParentCredentials) {
                            credentialsToStore.push({
                                userId: parentUserDocs[0]._id,
                                schoolId: studentData.schoolId,
                                initialUsername: existingParentCredentials.initialUsername,
                                initialPassword: existingParentCredentials.initialPassword,
                                hasChangedPassword: existingParentCredentials.hasChangedPassword,
                                role: "parent",
                                associatedStudentId: newStudent[0]._id,
                                issuedBy: new mongoose_1.Types.ObjectId(adminUserId),
                            });
                        }
                        else {
                            credentialsToStore.push({
                                userId: parentUserDocs[0]._id,
                                schoolId: studentData.schoolId,
                                initialUsername: credentials.parent.username,
                                initialPassword: credentials.parent.password,
                                hasChangedPassword: false,
                                role: "parent",
                                associatedStudentId: newStudent[0]._id,
                                issuedBy: new mongoose_1.Types.ObjectId(adminUserId),
                            });
                        }
                    }
                }
                const storedCredentials = await userCredentials_model_1.UserCredentials.insertMany(credentialsToStore, { session });
                storedCredentialIds = storedCredentials.map((doc) => doc._id);
            }
            await session.commitTransaction();
            await newStudent[0].populate([
                { path: "userId", select: "firstName lastName username email phone" },
                { path: "schoolId", select: "name" },
                { path: "parentId" },
            ]);
            studentDoc = newStudent[0];
            studentUserDoc = newUser[0];
            if (!schoolDoc) {
                throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, "School context unavailable during photo upload");
            }
            const cloudinaryFolderPath = (0, cloudinaryUtils_1.generateCloudinaryFolderPath)(schoolDoc.name, "student", studentData.firstName, new Date(studentData.dob), studentData.bloodGroup, new Date(studentData.admissionDate || Date.now()), studentData.grade, studentData.section, studentId);
            const cloudinaryResults = await (0, cloudinaryUtils_1.uploadPhotosToCloudinary)(photos, cloudinaryFolderPath, studentId);
            uploadedPublicIds.push(...cloudinaryResults.map((result) => result.public_id));
            const photoDocuments = cloudinaryResults.map((result) => ({
                studentId: studentDoc._id,
                schoolId: studentData.schoolId,
                photoNumber: result.photoNumber,
                photoPath: result.secure_url,
                filename: result.public_id,
                originalName: result.originalName,
                mimetype: "image/jpeg",
                size: result.size || 0,
            }));
            const uploadedPhotos = await student_model_1.StudentPhoto.insertMany(photoDocuments);
            const age = new Date().getFullYear() - new Date(studentData.dob).getFullYear();
            const admitDate = new Date(studentData.admissionDate || Date.now())
                .toISOString()
                .split("T")[0];
            try {
                await fileUtils_1.FileUtils.createStudentPhotoFolder(schoolDoc.name, {
                    firstName: studentData.firstName,
                    age,
                    grade: studentData.grade,
                    section: studentData.section,
                    bloodGroup: studentData.bloodGroup,
                    admitDate,
                    studentId: studentId,
                });
            }
            catch (error) {
                console.warn("Failed to create photo folder:", error);
            }
            const response = this.formatStudentResponse(studentDoc);
            if (uploadedPhotos.length > 0) {
                response.photos = uploadedPhotos.map((photo) => ({
                    id: photo._id.toString(),
                    photoPath: photo.photoPath,
                    photoNumber: photo.photoNumber,
                    filename: photo.filename,
                    size: photo.size,
                    createdAt: photo.createdAt,
                }));
                response.photoCount = uploadedPhotos.length;
            }
            if (credentials) {
                let parentCredentials = {
                    username: credentials.parent.username,
                    password: credentials.parent.password,
                };
                if (parentUserDocs && parentUserDocs.length > 0) {
                    const existingParentCredentials = await userCredentials_model_1.UserCredentials.findOne({
                        userId: parentUserDocs[0]._id,
                        role: "parent",
                    });
                    if (existingParentCredentials) {
                        parentCredentials = {
                            username: existingParentCredentials.initialUsername,
                            password: existingParentCredentials.initialPassword,
                        };
                    }
                }
                response.credentials = {
                    student: {
                        username: credentials.student.username,
                        password: credentials.student.password,
                    },
                    parent: parentCredentials,
                };
            }
            return response;
        }
        catch (error) {
            if (session.inTransaction()) {
                await session.abortTransaction();
            }
            if (studentDoc) {
                try {
                    await student_model_1.StudentPhoto.deleteMany({ studentId: studentDoc._id });
                }
                catch (cleanupError) {
                    console.error("Failed to remove student photos after error:", cleanupError);
                }
                if (uploadedPublicIds.length > 0) {
                    try {
                        await Promise.all(uploadedPublicIds.map((publicId) => (0, cloudinaryUtils_1.deleteFromCloudinary)(publicId)));
                    }
                    catch (cleanupError) {
                        console.error("Failed to delete Cloudinary assets after error:", cleanupError);
                    }
                }
                try {
                    await student_model_1.Student.deleteOne({ _id: studentDoc._id });
                }
                catch (cleanupError) {
                    console.error("Failed to delete student record after photo failure:", cleanupError);
                }
                if (studentUserDoc) {
                    try {
                        await user_model_1.User.deleteOne({ _id: studentUserDoc._id });
                    }
                    catch (cleanupError) {
                        console.error("Failed to delete student user after photo failure:", cleanupError);
                    }
                }
                if (createdParentDoc) {
                    try {
                        await parent_model_1.Parent.deleteOne({ _id: createdParentDoc._id });
                    }
                    catch (cleanupError) {
                        console.error("Failed to delete parent record after photo failure:", cleanupError);
                    }
                }
                if (!parentWasExisting && parentUserDocs && parentUserDocs.length > 0) {
                    try {
                        await user_model_1.User.deleteOne({ _id: parentUserDocs[0]._id });
                    }
                    catch (cleanupError) {
                        console.error("Failed to delete parent user after photo failure:", cleanupError);
                    }
                }
                if (parentWasExisting && existingParentDoc) {
                    try {
                        await parent_model_1.Parent.updateOne({ _id: existingParentDoc._id }, { $pull: { children: studentDoc._id } });
                    }
                    catch (cleanupError) {
                        console.error("Failed to roll back existing parent relationship after photo failure:", cleanupError);
                    }
                }
                if (storedCredentialIds.length > 0) {
                    try {
                        await userCredentials_model_1.UserCredentials.deleteMany({
                            _id: { $in: storedCredentialIds },
                        });
                    }
                    catch (cleanupError) {
                        console.error("Failed to remove stored credentials after photo failure:", cleanupError);
                    }
                }
            }
            if (error instanceof AppError_1.AppError) {
                throw error;
            }
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to create student: ${error.message}`);
        }
        finally {
            session.endSession();
        }
    }
    async getStudents(queryParams) {
        try {
            const { page, limit, schoolId, grade, section, isActive, search, sortBy, sortOrder, } = queryParams;
            const skip = (page - 1) * limit;
            const query = {};
            if (schoolId) {
                query.schoolId = schoolId;
            }
            if (grade) {
                query.grade = grade;
            }
            if (section) {
                query.section = section;
            }
            if (isActive && isActive !== "all") {
                query.isActive = isActive === "true";
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
                query.$or = [{ studentId: { $regex: new RegExp(search, "i") } }];
            }
            const sort = {};
            if (sortBy === "firstName" || sortBy === "lastName") {
                sort.grade = 1;
                sort.section = 1;
                sort.rollNumber = 1;
            }
            else {
                sort[sortBy] = sortOrder === "desc" ? -1 : 1;
            }
            const [students, totalCount] = await Promise.all([
                student_model_1.Student.find(query)
                    .populate("userId", "firstName lastName username email phone")
                    .populate("schoolId", "_id name")
                    .populate({
                    path: "parentId",
                    select: "_id userId occupation address relationship",
                    populate: {
                        path: "userId",
                        select: "_id firstName lastName username email phone",
                    },
                })
                    .populate("photos")
                    .sort(sort)
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                student_model_1.Student.countDocuments(query),
            ]);
            const totalPages = Math.ceil(totalCount / limit);
            return {
                students: students.map((student) => this.formatStudentResponse(student)),
                totalCount,
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
            };
        }
        catch (error) {
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to fetch students: ${error.message}`);
        }
    }
    async getStudentById(id) {
        try {
            if (!mongoose_1.Types.ObjectId.isValid(id)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid student ID format");
            }
            const student = await student_model_1.Student.findById(id)
                .populate("userId", "firstName lastName username email phone")
                .populate("schoolId", "_id name schoolId establishedYear address contact affiliation logo")
                .populate({
                path: "parentId",
                select: "_id userId occupation address relationship",
                populate: {
                    path: "userId",
                    select: "_id firstName lastName username email phone",
                },
            })
                .populate("photos")
                .populate("photoCount")
                .lean();
            if (!student) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Student not found");
            }
            return this.formatStudentResponse(student);
        }
        catch (error) {
            if (error instanceof AppError_1.AppError) {
                throw error;
            }
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to fetch student: ${error.message}`);
        }
    }
    async updateStudent(id, updateData) {
        const session = await mongoose_1.default.startSession();
        try {
            if (!mongoose_1.Types.ObjectId.isValid(id)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid student ID format");
            }
            session.startTransaction();
            const student = await student_model_1.Student.findById(id).session(session);
            if (!student) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Student not found");
            }
            const studentUpdateData = {};
            if (updateData.grade !== undefined)
                studentUpdateData.grade = updateData.grade;
            if (updateData.section !== undefined)
                studentUpdateData.section = updateData.section;
            if (updateData.bloodGroup !== undefined)
                studentUpdateData.bloodGroup = updateData.bloodGroup;
            if (updateData.dob !== undefined)
                studentUpdateData.dob = new Date(updateData.dob);
            if (updateData.rollNumber !== undefined)
                studentUpdateData.rollNumber = updateData.rollNumber;
            if (updateData.isActive !== undefined)
                studentUpdateData.isActive = updateData.isActive;
            if (updateData.address !== undefined)
                studentUpdateData.address = updateData.address;
            if (Object.keys(studentUpdateData).length > 0) {
                await student_model_1.Student.findByIdAndUpdate(id, { $set: studentUpdateData }, { new: true, runValidators: true, session });
            }
            if (updateData.parentInfo && student.parentId) {
                const parentUpdateData = {};
                if (updateData.parentInfo.name) {
                    const nameParts = updateData.parentInfo.name.trim().split(/\s+/);
                    const firstName = nameParts[0] || "";
                    const lastName = nameParts.slice(1).join(" ") || "";
                    await user_model_1.User.findOneAndUpdate({
                        _id: {
                            $in: await parent_model_1.Parent.findById(student.parentId).then((p) => p?.userId),
                        },
                    }, {
                        $set: {
                            firstName,
                            lastName,
                            ...(updateData.parentInfo.email && {
                                email: updateData.parentInfo.email,
                            }),
                            ...(updateData.parentInfo.phone && {
                                phone: updateData.parentInfo.phone,
                            }),
                        },
                    }, { session });
                }
                if (updateData.parentInfo.address || updateData.parentInfo.occupation) {
                    await parent_model_1.Parent.findByIdAndUpdate(student.parentId, {
                        $set: {
                            ...(updateData.parentInfo.address && {
                                address: updateData.parentInfo.address,
                            }),
                            ...(updateData.parentInfo.occupation && {
                                occupation: updateData.parentInfo.occupation,
                            }),
                        },
                    }, { session });
                }
            }
            await session.commitTransaction();
            const updatedStudent = await student_model_1.Student.findById(id)
                .populate("userId", "firstName lastName username email phone")
                .populate("schoolId", "_id name")
                .populate({
                path: "parentId",
                select: "_id userId occupation address relationship",
                populate: {
                    path: "userId",
                    select: "_id firstName lastName username email phone",
                },
            })
                .lean();
            if (!updatedStudent) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Updated student not found");
            }
            return this.formatStudentResponse(updatedStudent);
        }
        catch (error) {
            await session.abortTransaction();
            if (error instanceof AppError_1.AppError) {
                throw error;
            }
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to update student: ${error.message}`);
        }
        finally {
            session.endSession();
        }
    }
    async deleteStudent(id) {
        try {
            if (!mongoose_1.Types.ObjectId.isValid(id)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid student ID format");
            }
            const student = await student_model_1.Student.findById(id)
                .populate("userId", "firstName lastName")
                .populate("schoolId", "_id name");
            if (!student) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Student not found");
            }
            if (student.userId) {
                await user_model_1.User.findByIdAndDelete(student.userId);
            }
            try {
                const age = new Date().getFullYear() - new Date(student.dob).getFullYear();
                const admitDate = student.admissionDate.toISOString().split("T")[0];
                const folderPath = await fileUtils_1.FileUtils.createStudentPhotoFolder(student.schoolId.name, {
                    firstName: student.userId.firstName,
                    age,
                    grade: student.grade,
                    section: student.section,
                    bloodGroup: student.bloodGroup,
                    admitDate,
                    studentId: student.studentId,
                });
                await fileUtils_1.FileUtils.deleteFolder(folderPath);
            }
            catch (error) {
                console.warn("Failed to delete photo folder:", error);
            }
            await student.deleteOne();
        }
        catch (error) {
            if (error instanceof AppError_1.AppError) {
                throw error;
            }
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to delete student: ${error.message}`);
        }
    }
    async uploadPhotos(studentId, files) {
        try {
            if (!mongoose_1.Types.ObjectId.isValid(studentId)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid student ID format");
            }
            const student = await student_model_1.Student.findById(studentId)
                .populate("userId", "firstName lastName")
                .populate("schoolId", "_id name");
            if (!student) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Student not found");
            }
            const currentPhotoCount = await student_model_1.StudentPhoto.countDocuments({
                studentId,
            });
            const remainingSlots = config_1.default.max_photos_per_student - currentPhotoCount;
            if (files.length > remainingSlots) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, `Can only upload ${remainingSlots} more photos. Maximum ${config_1.default.max_photos_per_student} photos allowed per student.`);
            }
            for (const file of files) {
                const validation = fileUtils_1.FileUtils.validateImageFile(file);
                if (!validation.isValid) {
                    throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, validation.error);
                }
            }
            const cloudinaryFolderPath = (0, cloudinaryUtils_1.generateCloudinaryFolderPath)(student.schoolId.name, "student", student.userId.firstName, new Date(student.dob), student.bloodGroup, new Date(student.admissionDate), student.grade, student.section, student.studentId);
            const cloudinaryResults = await (0, cloudinaryUtils_1.uploadPhotosToCloudinary)(files, cloudinaryFolderPath, student.studentId);
            const uploadedPhotos = [];
            for (const result of cloudinaryResults) {
                const photoRecord = await student_model_1.StudentPhoto.create({
                    studentId,
                    schoolId: student.schoolId,
                    photoPath: result.secure_url,
                    photoNumber: result.photoNumber,
                    filename: result.public_id,
                    originalName: result.originalName,
                    mimetype: "image/jpeg",
                    size: result.size || 0,
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
    async deletePhoto(studentId, photoId) {
        try {
            if (!mongoose_1.Types.ObjectId.isValid(studentId) ||
                !mongoose_1.Types.ObjectId.isValid(photoId)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid ID format");
            }
            const photo = await student_model_1.StudentPhoto.findOne({ _id: photoId, studentId });
            if (!photo) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Photo not found");
            }
            await (0, cloudinaryUtils_1.deleteFromCloudinary)(photo.filename);
            await photo.deleteOne();
        }
        catch (error) {
            if (error instanceof AppError_1.AppError) {
                throw error;
            }
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to delete photo: ${error.message}`);
        }
    }
    async getStudentsByGradeAndSection(schoolId, grade, section) {
        try {
            if (!mongoose_1.Types.ObjectId.isValid(schoolId)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid school ID format");
            }
            const students = await student_model_1.Student.findByGradeAndSection(schoolId, grade, section);
            return students.map((student) => this.formatStudentResponse(student));
        }
        catch (error) {
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to fetch students by grade and section: ${error.message}`);
        }
    }
    async getStudentStats(schoolId) {
        try {
            if (!mongoose_1.Types.ObjectId.isValid(schoolId)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid school ID format");
            }
            const [totalStudents, activeStudents, gradeStats, sectionStats, recentAdmissions,] = await Promise.all([
                student_model_1.Student.countDocuments({ schoolId }),
                student_model_1.Student.countDocuments({ schoolId, isActive: true }),
                student_model_1.Student.aggregate([
                    { $match: { schoolId: new mongoose_1.Types.ObjectId(schoolId) } },
                    { $group: { _id: "$grade", count: { $sum: 1 } } },
                    { $sort: { _id: 1 } },
                ]),
                student_model_1.Student.aggregate([
                    { $match: { schoolId: new mongoose_1.Types.ObjectId(schoolId) } },
                    { $group: { _id: "$section", count: { $sum: 1 } } },
                    { $sort: { _id: 1 } },
                ]),
                student_model_1.Student.countDocuments({
                    schoolId,
                    admissionDate: {
                        $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                    },
                }),
            ]);
            return {
                totalStudents,
                activeStudents,
                byGrade: gradeStats.map((stat) => ({
                    grade: stat._id,
                    count: stat.count,
                })),
                bySection: sectionStats.map((stat) => ({
                    section: stat._id,
                    count: stat.count,
                })),
                recentAdmissions,
            };
        }
        catch (error) {
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to fetch student stats: ${error.message}`);
        }
    }
    async getStudentPhotos(studentId) {
        try {
            if (!mongoose_1.Types.ObjectId.isValid(studentId)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid student ID format");
            }
            const photos = await student_model_1.StudentPhoto.find({ studentId })
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
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to fetch student photos: ${error.message}`);
        }
    }
    async getStudentCredentials(studentId) {
        try {
            if (!mongoose_1.Types.ObjectId.isValid(studentId)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid student ID format");
            }
            const student = await student_model_1.Student.findById(studentId)
                .populate("userId", "firstName lastName username email phone")
                .populate({
                path: "parentId",
                populate: {
                    path: "userId",
                    select: "firstName lastName username email phone",
                },
            })
                .lean();
            if (!student) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Student not found");
            }
            const [studentCredentials, parentCredentials] = await Promise.all([
                userCredentials_model_1.UserCredentials.findOne({
                    userId: student.userId,
                    role: "student",
                }).lean(),
                userCredentials_model_1.UserCredentials.findOne({
                    associatedStudentId: student._id,
                    role: "parent",
                }).lean(),
            ]);
            if (!studentCredentials) {
                return null;
            }
            const result = {
                student: {
                    id: student.studentId,
                    username: studentCredentials.initialUsername,
                    password: studentCredentials.initialPassword,
                    email: student.userId.email,
                    phone: student.userId.phone,
                },
                parent: {
                    id: student.parentId
                        ? student.parentId.parentId || "N/A"
                        : "N/A",
                    username: parentCredentials?.initialUsername || "N/A",
                    password: parentCredentials?.initialPassword || "N/A",
                    email: student.parentId
                        ? student.parentId.userId?.email
                        : undefined,
                    phone: student.parentId
                        ? student.parentId.userId?.phone
                        : undefined,
                },
            };
            return result;
        }
        catch (error) {
            if (error instanceof AppError_1.AppError) {
                throw error;
            }
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to retrieve student credentials: ${error.message}`);
        }
    }
    async getAvailablePhotoSlots(studentId) {
        try {
            if (!mongoose_1.Types.ObjectId.isValid(studentId)) {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid student ID format");
            }
            const student = await student_model_1.Student.findById(studentId)
                .populate("userId", "firstName")
                .populate("schoolId", "_id name");
            if (!student) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Student not found");
            }
            const age = new Date().getFullYear() - new Date(student.dob).getFullYear();
            const admitDate = student.admissionDate.toISOString().split("T")[0];
            const folderPath = await fileUtils_1.FileUtils.createStudentPhotoFolder(student.schoolId.name, {
                firstName: student.userId.firstName,
                age,
                grade: student.grade,
                section: student.section,
                bloodGroup: student.bloodGroup,
                admitDate,
                studentId: student.studentId,
            });
            return await fileUtils_1.FileUtils.getAvailablePhotoNumbers(folderPath);
        }
        catch (error) {
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to get available photo slots: ${error.message}`);
        }
    }
    formatStudentResponse(student) {
        const age = student.dob
            ? new Date().getFullYear() - new Date(student.dob).getFullYear()
            : 0;
        const admissionYear = student.admissionDate
            ? new Date(student.admissionDate).getFullYear()
            : new Date().getFullYear();
        const extractId = (obj) => {
            if (!obj)
                return "";
            if (typeof obj === "string")
                return obj;
            if (obj._id)
                return obj._id.toString();
            if (obj.id)
                return obj.id.toString();
            return obj.toString();
        };
        const userData = student.userId || student.user;
        return {
            id: extractId(student._id || student.id),
            userId: extractId(student.userId),
            schoolId: extractId(student.schoolId),
            studentId: student.studentId,
            grade: student.grade,
            section: student.section,
            bloodGroup: student.bloodGroup,
            dob: student.dob ? student.dob.toISOString().split("T")[0] : undefined,
            admissionDate: student.admissionDate
                ? student.admissionDate.toISOString().split("T")[0]
                : undefined,
            admissionYear,
            parentId: extractId(student.parentId),
            rollNumber: student.rollNumber,
            isActive: student.isActive !== undefined ? student.isActive : true,
            age,
            address: student.address || undefined,
            createdAt: student.createdAt,
            updatedAt: student.updatedAt,
            user: userData
                ? {
                    id: extractId(userData),
                    username: userData.username || "",
                    firstName: userData.firstName || "",
                    lastName: userData.lastName || "",
                    fullName: `${userData.firstName || ""} ${userData.lastName || ""}`.trim() ||
                        "Unknown User",
                    email: userData.email,
                    phone: userData.phone,
                }
                : undefined,
            school: student.schoolId
                ? {
                    id: extractId(student.schoolId),
                    name: student.schoolId.name || "Unknown School",
                    schoolId: student.schoolId.schoolId,
                    establishedYear: student.schoolId.establishedYear,
                    address: student.schoolId.address,
                    contact: student.schoolId.contact,
                    affiliation: student.schoolId.affiliation,
                    logo: student.schoolId.logo,
                }
                : undefined,
            parent: student.parentId
                ? {
                    id: extractId(student.parentId),
                    userId: student.parentId.userId
                        ? extractId(student.parentId.userId)
                        : undefined,
                    fullName: student.parentId.userId
                        ? `${student.parentId.userId.firstName || ""} ${student.parentId.userId.lastName || ""}`.trim()
                        : "Unknown Parent",
                    name: student.parentId.userId
                        ? `${student.parentId.userId.firstName || ""} ${student.parentId.userId.lastName || ""}`.trim()
                        : "Unknown Parent",
                    email: student.parentId.userId?.email || undefined,
                    phone: student.parentId.userId?.phone || undefined,
                    address: student.parentId.address
                        ? `${student.parentId.address.street || ""} ${student.parentId.address.city || ""} ${student.parentId.address.state || ""} ${student.parentId.address.country || ""}`.trim()
                        : undefined,
                    occupation: student.parentId.occupation || undefined,
                    relationship: student.parentId.relationship || undefined,
                }
                : undefined,
            photos: student.photos?.map((photo) => ({
                id: extractId(photo),
                photoPath: photo.photoPath,
                photoNumber: photo.photoNumber,
                filename: photo.filename,
                size: photo.size,
                createdAt: photo.createdAt,
            })) || [],
            photoCount: student.photos?.length || 0,
        };
    }
    async getStudentDashboard(studentId) {
        const student = await student_model_1.Student.findOne({ userId: studentId })
            .populate("schoolId", "name")
            .populate("userId", "firstName lastName fullName email phone")
            .populate("parentId", "fullName email phone address occupation relationship");
        if (!student) {
            throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Student not found");
        }
        const currentMonth = new Date();
        currentMonth.setDate(1);
        const nextMonth = new Date(currentMonth);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        const attendanceRecords = await attendance_model_1.Attendance.aggregate([
            {
                $match: {
                    "students.studentId": student._id,
                    date: { $gte: currentMonth, $lt: nextMonth },
                },
            },
            { $unwind: "$students" },
            { $match: { "students.studentId": student._id } },
        ]);
        const totalDays = attendanceRecords.length;
        const presentDays = attendanceRecords.filter((record) => record.students.status === "present").length;
        const attendancePercentage = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;
        const pendingHomework = await homework_model_1.Homework.countDocuments({
            "assignments.studentId": student._id,
            "assignments.status": { $in: ["pending", "overdue"] },
        });
        const assessmentOverview = await assessment_service_1.assessmentService.getStudentOverview(student._id);
        const overallPercentage = assessmentOverview.overall?.averagePercentage || 0;
        const overallGrade = this.deriveGradeLetter(overallPercentage);
        const today = new Date();
        const dayOfWeek = today
            .toLocaleString("en-US", { weekday: "long" })
            .toLowerCase();
        const todayClasses = await schedule_model_1.Schedule.countDocuments({
            grade: student.grade,
            section: student.section,
            dayOfWeek: dayOfWeek,
            isActive: true,
        });
        const recentGradesList = assessmentOverview.recent
            .slice(0, 5)
            .map((item) => ({
            subject: item.subjectName,
            grade: item.grade,
            percentage: item.percentage,
            examDate: item.examDate,
            examName: item.examName,
        }));
        const upcomingAssignments = await homework_model_1.Homework.aggregate([
            {
                $match: {
                    "assignments.studentId": student._id,
                    "assignments.status": { $in: ["pending", "assigned"] },
                    dueDate: { $gte: new Date() },
                },
            },
            { $unwind: "$assignments" },
            { $match: { "assignments.studentId": student._id } },
            {
                $project: {
                    title: "$title",
                    subject: "$subject",
                    dueDate: {
                        $dateToString: { format: "%Y-%m-%d", date: "$dueDate" },
                    },
                    status: "$assignments.status",
                },
            },
            { $sort: { dueDate: 1 } },
            { $limit: 5 },
        ]);
        const upcomingEvents = await academic_calendar_model_1.AcademicCalendar.countDocuments({
            startDate: { $gte: today },
            isActive: true,
        });
        const upcomingAssessments = await assessment_model_1.Assessment.find({
            schoolId: student.schoolId,
            grade: student.grade,
            section: student.section,
            isArchived: false,
            examDate: { $gte: new Date() },
        })
            .populate("subjectId", "name code")
            .sort({ examDate: 1 })
            .limit(5)
            .lean();
        return {
            student: {
                id: student._id,
                studentId: student.studentId,
                grade: student.grade,
                section: student.section,
                rollNumber: student.rollNumber,
                fullName: student.userId?.fullName || "",
                email: student.userId?.email || "",
                phone: student.userId?.phone || "",
            },
            attendancePercentage,
            overallGrade,
            overallPercentage,
            pendingHomework,
            todayClasses,
            upcomingEvents,
            recentGrades: recentGradesList,
            upcomingAssignments,
            upcomingAssessments: upcomingAssessments.map((assessment) => ({
                id: assessment._id.toString(),
                examName: assessment.examName,
                examTypeLabel: assessment.examTypeLabel,
                examDate: assessment.examDate,
                totalMarks: assessment.totalMarks,
                subjectName: assessment.subjectId?.name,
                subjectCode: assessment.subjectId?.code,
            })),
        };
    }
    async getStudentAttendance(studentId) {
        const student = await student_model_1.Student.findOne({ userId: studentId });
        if (!student) {
            throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Student not found");
        }
        const currentYear = new Date().getFullYear();
        const startOfYear = new Date(currentYear, 0, 1);
        const endOfYear = new Date(currentYear + 1, 0, 1);
        const attendanceRecords = await day_attendance_model_1.StudentDayAttendance.find({
            schoolId: student.schoolId,
            studentId: student._id,
            date: { $gte: startOfYear, $lte: endOfYear },
        })
            .sort({ date: -1 })
            .lean();
        const totalDays = attendanceRecords.length;
        const presentDays = attendanceRecords.filter((r) => ["present", "late"].includes(r.finalStatus)).length;
        const absentDays = attendanceRecords.filter((r) => r.finalStatus === "absent").length;
        const lateDays = attendanceRecords.filter((r) => r.finalStatus === "late").length;
        const monthlyMap = new Map();
        attendanceRecords.forEach((record) => {
            const date = new Date(record.date);
            const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
            if (!monthlyMap.has(key)) {
                monthlyMap.set(key, {
                    month: date.getMonth() + 1,
                    year: date.getFullYear(),
                    totalDays: 0,
                    presentDays: 0,
                    absentDays: 0,
                    lateDays: 0,
                });
            }
            const stats = monthlyMap.get(key);
            stats.totalDays++;
            if (record.finalStatus === "present")
                stats.presentDays++;
            if (record.finalStatus === "absent")
                stats.absentDays++;
            if (record.finalStatus === "late")
                stats.lateDays++;
        });
        const monthlyStats = Array.from(monthlyMap.values()).map((m) => ({
            ...m,
            percentage: m.totalDays > 0 ? Math.round((m.presentDays / m.totalDays) * 100) : 0,
        }));
        const recentRecords = attendanceRecords.slice(0, 10).map((record) => ({
            date: record.date,
            status: record.finalStatus,
            markedAt: record.teacherMarkedAt || record.autoMarkedAt || record.finalizedAt,
            autoDetected: !!record.autoStatus,
            teacherMarked: !!record.teacherStatus,
            source: record.finalSource,
        }));
        return {
            summary: {
                totalDays,
                presentDays,
                absentDays,
                lateDays,
                attendancePercentage: totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0,
            },
            monthlyStats,
            recentRecords,
        };
    }
    async getStudentGrades(studentId) {
        const student = await student_model_1.Student.findOne({ userId: studentId });
        if (!student) {
            throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Student not found");
        }
        return assessment_service_1.assessmentService.getStudentOverview(student._id);
    }
    async getStudentHomework(studentId) {
        const student = await student_model_1.Student.findOne({ userId: studentId });
        if (!student) {
            throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Student not found");
        }
        const homework = await homework_model_1.Homework.aggregate([
            {
                $match: {
                    schoolId: student.schoolId,
                    grade: student.grade,
                    section: student.section || { $exists: true },
                    isPublished: true,
                },
            },
            {
                $lookup: {
                    from: "subjects",
                    localField: "subjectId",
                    foreignField: "_id",
                    as: "subject",
                },
            },
            { $unwind: "$subject" },
            {
                $lookup: {
                    from: "teachers",
                    localField: "teacherId",
                    foreignField: "_id",
                    as: "teacher",
                },
            },
            { $unwind: "$teacher" },
            {
                $lookup: {
                    from: "users",
                    localField: "teacher.userId",
                    foreignField: "_id",
                    as: "teacherUser",
                },
            },
            { $unwind: "$teacherUser" },
            {
                $lookup: {
                    from: "homeworksubmissions",
                    let: { homeworkId: "$_id", studentId: student._id },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$homeworkId", "$$homeworkId"] },
                                        { $eq: ["$studentId", "$$studentId"] },
                                    ],
                                },
                            },
                        },
                    ],
                    as: "submission",
                },
            },
            {
                $project: {
                    homeworkId: "$_id",
                    title: 1,
                    description: 1,
                    subject: "$subject.name",
                    teacherName: "$teacherUser.fullName",
                    assignedDate: 1,
                    dueDate: 1,
                    status: {
                        $ifNull: [
                            { $arrayElemAt: ["$submission.status", 0] },
                            {
                                $cond: [
                                    { $lt: ["$dueDate", new Date()] },
                                    "overdue",
                                    "pending",
                                ],
                            },
                        ],
                    },
                    submittedAt: { $arrayElemAt: ["$submission.submittedAt", 0] },
                    grade: { $arrayElemAt: ["$submission.grade", 0] },
                    feedback: { $arrayElemAt: ["$submission.feedback", 0] },
                    attachments: 1,
                },
            },
            { $sort: { dueDate: 1, assignedDate: -1 } },
        ]);
        const totalHomework = homework.length;
        const completedHomework = homework.filter((h) => h.status === "submitted" || h.status === "graded").length;
        const pendingHomework = homework.filter((h) => h.status === "pending").length;
        const overdueHomework = homework.filter((h) => {
            return h.status === "overdue";
        }).length;
        return {
            summary: {
                totalHomework,
                completedHomework,
                pendingHomework,
                overdueHomework,
                completionRate: totalHomework > 0
                    ? Math.round((completedHomework / totalHomework) * 100)
                    : 0,
            },
            homework: homework,
        };
    }
    async getStudentSchedule(studentId) {
        const student = await student_model_1.Student.findOne({ userId: studentId });
        if (!student) {
            throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Student not found");
        }
        const schedule = await schedule_model_1.Schedule.aggregate([
            {
                $match: {
                    schoolId: student.schoolId,
                    grade: student.grade,
                    section: student.section,
                    isActive: true,
                },
            },
            { $unwind: "$periods" },
            { $match: { "periods.isBreak": { $ne: true } } },
            {
                $lookup: {
                    from: "subjects",
                    localField: "periods.subjectId",
                    foreignField: "_id",
                    as: "subject",
                },
            },
            { $unwind: "$subject" },
            {
                $lookup: {
                    from: "teachers",
                    localField: "periods.teacherId",
                    foreignField: "_id",
                    as: "teacher",
                },
            },
            { $unwind: "$teacher" },
            {
                $lookup: {
                    from: "users",
                    localField: "teacher.userId",
                    foreignField: "_id",
                    as: "teacherUser",
                },
            },
            { $unwind: "$teacherUser" },
            {
                $project: {
                    dayOfWeek: 1,
                    period: "$periods.periodNumber",
                    startTime: "$periods.startTime",
                    endTime: "$periods.endTime",
                    subject: "$subject.name",
                    subjectId: "$subject._id",
                    teacherName: "$teacherUser.fullName",
                    teacherId: "$teacher._id",
                    className: {
                        $concat: [
                            "Grade ",
                            { $toString: "$grade" },
                            " - Section ",
                            "$section",
                        ],
                    },
                    room: "$periods.roomNumber",
                    isActive: 1,
                },
            },
            { $sort: { dayOfWeek: 1, period: 1 } },
        ]);
        const daysOfWeek = [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
        ];
        const scheduleByDay = daysOfWeek.map((day) => ({
            day: day,
            periods: schedule
                .filter((s) => s.dayOfWeek === day)
                .sort((a, b) => a.period - b.period),
        }));
        return {
            grade: student.grade,
            section: student.section,
            scheduleByDay,
            totalPeriods: schedule.length,
        };
    }
    async getStudentCalendar(studentId) {
        const student = await student_model_1.Student.findOne({ userId: studentId });
        if (!student) {
            throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Student not found");
        }
        const { eventService } = await Promise.resolve().then(() => __importStar(require("../event/event.service")));
        const eventsResult = await eventService.getEvents(student.schoolId, "student", student.grade, student.section, { limit: 100, isActive: true });
        const todaysEvents = await eventService.getTodaysEvents(student.schoolId, "student", student.grade, student.section);
        const calendarEvents = eventsResult.events.map((event) => ({
            title: event.title,
            description: event.description,
            eventType: event.type,
            startDate: event.date,
            endDate: event.date,
            color: this.getEventColor(event.type),
            targetAudience: event.targetAudience,
        }));
        const upcomingAssessmentsForCalendar = await assessment_model_1.Assessment.find({
            schoolId: student.schoolId,
            grade: student.grade,
            section: student.section,
            examDate: { $gte: new Date() },
            isArchived: false,
        })
            .populate("subjectId", "name")
            .sort({ examDate: 1 })
            .limit(10)
            .lean();
        const upcomingHomework = await homework_model_1.Homework.aggregate([
            {
                $match: {
                    "assignments.studentId": student._id,
                    "assignments.status": { $in: ["pending", "assigned"] },
                    dueDate: { $gte: new Date() },
                },
            },
            { $unwind: "$assignments" },
            { $match: { "assignments.studentId": student._id } },
            {
                $lookup: {
                    from: "subjects",
                    localField: "subjectId",
                    foreignField: "_id",
                    as: "subject",
                },
            },
            { $unwind: "$subject" },
            {
                $project: {
                    title: { $concat: ["Homework: ", "$title"] },
                    description: {
                        $concat: ["Due: ", "$title", " (", "$subject.name", ")"],
                    },
                    eventType: "homework",
                    startDate: "$dueDate",
                    endDate: "$dueDate",
                    color: "#f59e0b",
                    subject: "$subject.name",
                },
            },
            { $sort: { startDate: 1 } },
            { $limit: 10 },
        ]);
        const upcomingAssessmentEvents = upcomingAssessmentsForCalendar.map((assessment) => ({
            title: `${assessment.examName} - ${assessment.subjectId?.name ?? ""}`,
            description: `Exam: ${assessment.examName}`,
            eventType: "exam",
            startDate: assessment.examDate,
            endDate: assessment.examDate,
            color: "#ef4444",
            subject: assessment.subjectId?.name ?? "",
        }));
        const allEvents = [
            ...calendarEvents,
            ...upcomingAssessmentEvents,
            ...upcomingHomework,
        ];
        const result = {
            events: allEvents,
            summary: {
                totalEvents: allEvents.length,
                holidays: allEvents.filter((e) => e.eventType === "holiday").length,
                exams: allEvents.filter((e) => e.eventType === "exam").length,
                homework: allEvents.filter((e) => e.eventType === "homework").length,
            },
        };
        return result;
    }
    async getStudentDisciplinaryActions(userId) {
        try {
            const student = await student_model_1.Student.findOne({ userId });
            if (!student) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Student not found");
            }
            const { DisciplinaryAction } = await Promise.resolve().then(() => __importStar(require("../disciplinary/disciplinary.model")));
            const actions = await DisciplinaryAction.find({
                studentId: student._id,
                isRedWarrant: true,
            })
                .populate({
                path: "teacherId",
                select: "userId",
                populate: {
                    path: "userId",
                    select: "firstName lastName",
                },
            })
                .sort({ issuedDate: -1 });
            const stats = await DisciplinaryAction.getDisciplinaryStats(student.schoolId.toString(), {
                studentId: student._id,
                isRedWarrant: true,
            });
            const formattedActions = actions.map((action) => {
                const teacher = action.teacherId;
                const teacherUser = teacher?.userId;
                return {
                    id: action._id,
                    teacherName: teacherUser
                        ? `${teacherUser.firstName} ${teacherUser.lastName}`
                        : "N/A",
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
                    resolutionNotes: action.resolutionNotes,
                    canAppeal: action.canAppeal ? action.canAppeal() : false,
                    isOverdue: action.isOverdue ? action.isOverdue() : false,
                };
            });
            return {
                actions: formattedActions,
                stats,
            };
        }
        catch (error) {
            if (error instanceof AppError_1.AppError)
                throw error;
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, `Failed to get student disciplinary actions: ${error.message}`);
        }
    }
}
exports.studentService = new StudentService();
//# sourceMappingURL=student.service.js.map