import httpStatus from "http-status";
import { Types, startSession } from "mongoose";
import path from "path";
import config from "../../config";
import { AppError } from "../../errors/AppError";
import { FileUtils } from "../../utils/fileUtils";
import { CredentialGenerator } from "../../utils/credentialGenerator"; // Updated credential generator
import { School } from "../school/school.model";
import { User } from "../user/user.model";
import { Teacher, TeacherPhoto } from "./teacher.model";
import { Subject } from "../subject/subject.model";
import { Schedule } from "../schedule/schedule.model";
import { Attendance } from "../attendance/attendance.model";
import { Student } from "../student/student.model";
import {
  StudentDayAttendance,
  normaliseDateKey,
} from "../attendance/day-attendance.model";
import { findHolidayEventsForClass } from "../attendance/holiday-utils";
import { Homework } from "../homework/homework.model";
import { Notification } from "../notification/notification.model";
import {
  ICreateTeacherRequest,
  IUpdateTeacherRequest,
  ITeacherResponse,
  ITeacherPhotoResponse,
  ITeacherStats,
} from "./teacher.interface";

class TeacherService {
  async createTeacher(
    teacherData: ICreateTeacherRequest,
    files?: Express.Multer.File[]
  ): Promise<ITeacherResponse> {
    const session = await startSession();
    session.startTransaction();

    try {
      // Verify school exists and is active using MongoDB ObjectId
      const school = await School.findById(
        new Types.ObjectId(teacherData.schoolId)
      );
      if (!school) {
        throw new AppError(httpStatus.NOT_FOUND, "School not found");
      }

      if (school.status !== "active") {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          "Cannot create teacher for inactive school"
        );
      }

      // Generate teacher ID and employee ID
      const joiningYear = teacherData.joinDate
        ? new Date(teacherData.joinDate).getFullYear()
        : new Date().getFullYear();

      const { teacherId, employeeId } =
        await CredentialGenerator.generateUniqueTeacherId(
          joiningYear,
          teacherData.schoolId,
          teacherData.designation
        );

      // Generate secure credentials
      const credentials = await CredentialGenerator.generateTeacherCredentials(
        teacherData.firstName,
        teacherData.lastName,
        teacherId
      );

      // Create user account for teacher FIRST (similar to school-admin creation)

      const newUser = await User.create(
        [
          {
            schoolId: new Types.ObjectId(teacherData.schoolId), // Ensure MongoDB ObjectId
            role: "teacher",
            username: credentials.username,
            passwordHash: credentials.hashedPassword,
            displayPassword: credentials.password,
            firstName: teacherData.firstName,
            lastName: teacherData.lastName,
            email: teacherData.email,
            phone: teacherData.phone,
            isActive: teacherData.isActive !== false, // Default to true if not specified
            requiresPasswordChange: credentials.requiresPasswordChange,
          },
        ],
        { session }
      );

      // Process experience data
      const experienceData = {
        totalYears: teacherData.experience.totalYears,
        previousSchools:
          teacherData.experience.previousSchools?.map((school) => ({
            ...school,
            fromDate: new Date(school.fromDate),
            toDate: new Date(school.toDate),
          })) || [],
      };

      // Create teacher record using the User's MongoDB ID (following school-admin pattern)
      const newTeacher = await Teacher.create(
        [
          {
            userId: newUser[0]._id, // Reference to the User document's MongoDB ObjectId
            schoolId: new Types.ObjectId(teacherData.schoolId), // Ensure MongoDB ObjectId
            teacherId,
            employeeId: employeeId, // Use auto-generated employee ID
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
                  netSalary:
                    (teacherData.salary.basic || 0) +
                    (teacherData.salary.allowances || 0) -
                    (teacherData.salary.deductions || 0),
                }
              : undefined,
            isClassTeacher: teacherData.isClassTeacher || false,
            classTeacherFor: teacherData.classTeacherFor,
            isActive: teacherData.isActive !== false, // Default to true if not specified
          },
        ],
        { session }
      );

      // Create photo folder structure
      const age =
        new Date().getFullYear() - new Date(teacherData.dob).getFullYear();
      const joinDate = new Date(teacherData.joinDate || Date.now())
        .toISOString()
        .split("T")[0];

      let folderPath: string | null = null;
      try {
        folderPath = await FileUtils.createTeacherPhotoFolder(school.name, {
          firstName: teacherData.firstName,
          age,
          bloodGroup: teacherData.bloodGroup,
          joinDate,
          teacherId,
        });
      } catch (error) {
        console.warn("Failed to create photo folder:", error);
        // Don't fail the teacher creation if folder creation fails
      }

      // Handle photo uploads if provided
      const photoResponses: ITeacherPhotoResponse[] = [];
      if (files && files.length > 0 && folderPath) {
        try {
          // Validate all files first
          for (const file of files) {
            const validation = FileUtils.validateImageFile(file);
            if (!validation.isValid) {
              throw new AppError(httpStatus.BAD_REQUEST, validation.error!);
            }
          }

          // Check photo count limit
          if (files.length > config.max_photos_per_student) {
            throw new AppError(
              httpStatus.BAD_REQUEST,
              `Cannot upload more than ${config.max_photos_per_student} photos`
            );
          }

          // Get available photo numbers
          const availableNumbers = await FileUtils.getAvailablePhotoNumbers(
            folderPath
          );

          if (files.length > availableNumbers.length) {
            throw new AppError(
              httpStatus.BAD_REQUEST,
              `Only ${availableNumbers.length} photo slots available`
            );
          }

          // Upload photos
          const uploadPromises = files.map(async (file, index) => {
            const photoNumber = availableNumbers[index];
            const photoResult = await FileUtils.savePhotoWithNumber(
              file,
              folderPath!,
              photoNumber
            );

            const photoDoc = await TeacherPhoto.create(
              [
                {
                  teacherId: newTeacher[0]._id,
                  schoolId: new Types.ObjectId(teacherData.schoolId), // Ensure MongoDB ObjectId
                  photoPath: photoResult.relativePath,
                  photoNumber,
                  filename: photoResult.filename,
                  originalName: file.originalname,
                  mimetype: file.mimetype,
                  size: file.size,
                },
              ],
              { session }
            );

            return {
              id: photoDoc[0]._id.toString(),
              photoPath: photoDoc[0].photoPath,
              photoNumber: photoDoc[0].photoNumber,
              filename: photoDoc[0].filename,
              size: photoDoc[0].size,
              createdAt: photoDoc[0].createdAt!,
            };
          });

          const uploadedPhotos = await Promise.all(uploadPromises);
          photoResponses.push(...uploadedPhotos);
        } catch (error) {
          console.error("Photo upload failed:", error);
          // Don't fail teacher creation if photo upload fails
        }
      }

      // Commit transaction
      await session.commitTransaction();

      // Populate and return
      await newTeacher[0].populate([
        { path: "userId", select: "firstName lastName username email phone" },
        { path: "schoolId", select: "name" },
      ]);

      const response = await this.formatTeacherResponse(newTeacher[0]);
      if (photoResponses.length > 0) {
        response.photos = photoResponses;
        response.photoCount = photoResponses.length;
      }

      // Add generated credentials to response
      (response as any).credentials = {
        username: credentials.username,
        password: credentials.password,
        teacherId: teacherId,
        employeeId: employeeId,
      };

      return response;
    } catch (error) {
      await session.abortTransaction();
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to create teacher: ${(error as Error).message}`
      );
    } finally {
      session.endSession();
    }
  }

  async getTeachers(queryParams: {
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
  }> {
    try {
      const {
        page,
        limit,
        schoolId,
        subject,
        grade,
        designation,
        isActive,
        isClassTeacher,
        search,
        sortBy,
        sortOrder,
      } = queryParams;
      const skip = (page - 1) * limit;

      // Build query
      const query: any = {};

      // Use MongoDB ObjectId for schoolId filtering
      if (schoolId) {
        query.schoolId = new Types.ObjectId(schoolId);
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

      // Build search query for user fields
      let userQuery: any = {};
      if (search) {
        userQuery.$or = [
          { firstName: { $regex: new RegExp(search, "i") } },
          { lastName: { $regex: new RegExp(search, "i") } },
          { username: { $regex: new RegExp(search, "i") } },
        ];
      }

      // If we have user search criteria, find matching users first
      let userIds: Types.ObjectId[] = [];
      if (Object.keys(userQuery).length > 0) {
        const matchingUsers = await User.find(userQuery).select("_id");
        userIds = matchingUsers.map((user) => user._id);
        query.userId = { $in: userIds };
      }

      // Handle teacher ID search separately
      if (search && !userQuery.$or) {
        query.$or = [
          { teacherId: { $regex: new RegExp(search, "i") } },
          { employeeId: { $regex: new RegExp(search, "i") } },
        ];
      }

      // Build sort
      const sort: any = {};
      if (sortBy === "firstName" || sortBy === "lastName") {
        // For user fields, we'll sort after population
        sort.designation = 1;
        sort.joinDate = -1;
      } else if (sortBy === "experience.totalYears") {
        sort["experience.totalYears"] = sortOrder === "desc" ? -1 : 1;
      } else {
        sort[sortBy] = sortOrder === "desc" ? -1 : 1;
      }

      // Execute queries using aggregation pipeline for better User data integration
      const aggregationPipeline: any[] = [
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
        Teacher.aggregate(aggregationPipeline),
        Teacher.countDocuments(query),
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      const formattedTeachers = await Promise.all(
        teachers.map((teacher) => this.formatTeacherResponse(teacher))
      );

      return {
        teachers: formattedTeachers,
        totalCount,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      };
    } catch (error) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to fetch teachers: ${(error as Error).message}`
      );
    }
  }

  async getTeacherById(id: string): Promise<ITeacherResponse> {
    try {
      if (!Types.ObjectId.isValid(id)) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid teacher ID format");
      }

      const teacher = await Teacher.findById(id)
        .populate("userId", "firstName lastName username email phone")
        .populate("schoolId", "name")
        .populate("photos")
        .populate("photoCount")
        .lean();

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      // Handle subject conversion if they are ObjectIds
      if (teacher.subjects && teacher.subjects.length > 0) {
        const subjectObjectIds = teacher.subjects.filter(
          (subject) =>
            typeof subject === "string" && /^[0-9a-fA-F]{24}$/.test(subject)
        );

        if (subjectObjectIds.length > 0) {
          const { Subject } = await import("../subject/subject.model");
          const subjectDocs = await Subject.find({
            _id: { $in: subjectObjectIds.map((id) => new Types.ObjectId(id)) },
          }).select("name");

          const subjectMap = new Map(
            subjectDocs.map((doc) => [doc._id.toString(), doc.name])
          );

          teacher.subjects = teacher.subjects.map((subject) => {
            if (
              typeof subject === "string" &&
              /^[0-9a-fA-F]{24}$/.test(subject)
            ) {
              return subjectMap.get(subject) || subject;
            }
            return subject;
          });
        }
      }

      return await this.formatTeacherResponse(teacher);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to fetch teacher: ${(error as Error).message}`
      );
    }
  }

  async updateTeacher(
    id: string,
    updateData: IUpdateTeacherRequest
  ): Promise<ITeacherResponse> {
    try {
      if (!Types.ObjectId.isValid(id)) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid teacher ID format");
      }

      const teacher = await Teacher.findById(id);
      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      // Prepare User data updates (if any user-related fields are provided)
      const userUpdateData: any = {};
      if (updateData.firstName) userUpdateData.firstName = updateData.firstName;
      if (updateData.lastName) userUpdateData.lastName = updateData.lastName;
      if (updateData.email) userUpdateData.email = updateData.email;
      if (updateData.phone) userUpdateData.phone = updateData.phone;

      // Update User document if there are user-related changes
      if (Object.keys(userUpdateData).length > 0) {
        await User.findByIdAndUpdate(
          teacher.userId,
          { $set: userUpdateData },
          { new: true, runValidators: true }
        );
      }

      // Prepare Teacher-specific data updates
      const teacherUpdateData: any = { ...updateData };
      // Remove user-related fields from teacher update data
      delete teacherUpdateData.firstName;
      delete teacherUpdateData.lastName;
      delete teacherUpdateData.email;
      delete teacherUpdateData.phone;

      // Convert date strings to Date objects if provided
      if (teacherUpdateData.dob) {
        teacherUpdateData.dob = new Date(teacherUpdateData.dob);
      }
      if (teacherUpdateData.joinDate) {
        teacherUpdateData.joinDate = new Date(teacherUpdateData.joinDate);
      }

      // Process salary if provided
      if (teacherUpdateData.salary) {
        const basic = teacherUpdateData.salary.basic || 0;
        const allowances = teacherUpdateData.salary.allowances || 0;
        const deductions = teacherUpdateData.salary.deductions || 0;
        teacherUpdateData.salary = {
          ...teacherUpdateData.salary,
          netSalary: basic + allowances - deductions,
        };
      }

      // Update Teacher document
      const updatedTeacher = await Teacher.findByIdAndUpdate(
        id,
        { $set: teacherUpdateData },
        { new: true, runValidators: true }
      )
        .populate("userId", "firstName lastName username email phone")
        .populate("schoolId", "name")
        .populate("photoCount")
        .lean();

      return await this.formatTeacherResponse(updatedTeacher!);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to update teacher: ${(error as Error).message}`
      );
    }
  }

  async deleteTeacher(id: string): Promise<void> {
    try {
      if (!Types.ObjectId.isValid(id)) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid teacher ID format");
      }

      const teacher = await Teacher.findById(id)
        .populate("userId", "firstName lastName")
        .populate("schoolId", "name");

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      // Delete associated user account
      if (teacher.userId) {
        await User.findByIdAndDelete(teacher.userId);
      }

      // Delete photo folder
      try {
        const age =
          new Date().getFullYear() - new Date(teacher.dob).getFullYear();
        const joinDate = teacher.joinDate.toISOString().split("T")[0];

        const folderPath = await FileUtils.createTeacherPhotoFolder(
          (teacher.schoolId as any).name,
          {
            firstName: (teacher.userId as any).firstName,
            age,
            bloodGroup: teacher.bloodGroup,
            joinDate,
            teacherId: teacher.teacherId,
          }
        );

        await FileUtils.deleteFolder(folderPath);
      } catch (error) {
        console.warn("Failed to delete photo folder:", error);
      }

      // The pre-delete middleware in the model will handle photo deletion
      await teacher.deleteOne();
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to delete teacher: ${(error as Error).message}`
      );
    }
  }

  async uploadPhotos(
    teacherId: string,
    files: Express.Multer.File[]
  ): Promise<ITeacherPhotoResponse[]> {
    try {
      if (!Types.ObjectId.isValid(teacherId)) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid teacher ID format");
      }

      const teacher = await Teacher.findById(teacherId)
        .populate("userId", "firstName lastName")
        .populate("schoolId", "name");

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      // Check current photo count
      const currentPhotoCount = await TeacherPhoto.countDocuments({
        teacherId,
      });
      const remainingSlots = config.max_photos_per_student - currentPhotoCount;

      if (files.length > remainingSlots) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Can only upload ${remainingSlots} more photos. Maximum ${config.max_photos_per_student} photos allowed per teacher.`
        );
      }

      // Validate all files first
      for (const file of files) {
        const validation = FileUtils.validateImageFile(file);
        if (!validation.isValid) {
          throw new AppError(httpStatus.BAD_REQUEST, validation.error!);
        }
      }

      // Get teacher folder path
      const age =
        new Date().getFullYear() - new Date(teacher.dob).getFullYear();
      const joinDate = teacher.joinDate.toISOString().split("T")[0];

      const folderPath = await FileUtils.createTeacherPhotoFolder(
        (teacher.schoolId as any).name,
        {
          firstName: (teacher.userId as any).firstName,
          age,
          bloodGroup: teacher.bloodGroup,
          joinDate,
          teacherId: teacher.teacherId,
        }
      );

      // Get available photo numbers
      const availableNumbers = await FileUtils.getAvailablePhotoNumbers(
        folderPath
      );

      if (files.length > availableNumbers.length) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Only ${availableNumbers.length} photo slots available`
        );
      }

      // Upload files and create records
      const uploadedPhotos: ITeacherPhotoResponse[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const photoNumber = availableNumbers[i];

        // Save file with numbered naming
        const fileInfo = await FileUtils.savePhotoWithNumber(
          file,
          folderPath,
          photoNumber
        );

        // Create photo record
        const photoRecord = await TeacherPhoto.create({
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
          createdAt: photoRecord.createdAt!,
        });
      }

      return uploadedPhotos;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to upload photos: ${(error as Error).message}`
      );
    }
  }

  async deletePhoto(teacherId: string, photoId: string): Promise<void> {
    try {
      if (
        !Types.ObjectId.isValid(teacherId) ||
        !Types.ObjectId.isValid(photoId)
      ) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid ID format");
      }

      const photo = await TeacherPhoto.findOne({ _id: photoId, teacherId });
      if (!photo) {
        throw new AppError(httpStatus.NOT_FOUND, "Photo not found");
      }

      // Delete physical file
      const fullPath = path.resolve(config.upload_path, photo.photoPath);
      await FileUtils.deleteFile(fullPath);

      // Delete database record
      await photo.deleteOne();
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to delete photo: ${(error as Error).message}`
      );
    }
  }

  async getTeachersBySubject(
    schoolId: string,
    subject: string
  ): Promise<ITeacherResponse[]> {
    try {
      if (!Types.ObjectId.isValid(schoolId)) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid school ID format");
      }

      const teachers = await Teacher.findBySubject(schoolId, subject);
      return await Promise.all(
        teachers.map((teacher) => this.formatTeacherResponse(teacher))
      );
    } catch (error) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to fetch teachers by subject: ${(error as Error).message}`
      );
    }
  }

  async getTeacherStats(schoolId: string): Promise<ITeacherStats> {
    try {
      if (!Types.ObjectId.isValid(schoolId)) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid school ID format");
      }

      const [
        totalTeachers,
        activeTeachers,
        classTeachers,
        designationStats,
        subjectStats,
        experienceStats,
        recentJoining,
      ] = await Promise.all([
        Teacher.countDocuments({ schoolId: new Types.ObjectId(schoolId) }),
        Teacher.countDocuments({
          schoolId: new Types.ObjectId(schoolId),
          isActive: true,
        }),
        Teacher.countDocuments({
          schoolId: new Types.ObjectId(schoolId),
          isClassTeacher: true,
        }),
        Teacher.aggregate([
          { $match: { schoolId: new Types.ObjectId(schoolId) } },
          { $group: { _id: "$designation", count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ]),
        Teacher.aggregate([
          { $match: { schoolId: new Types.ObjectId(schoolId) } },
          { $unwind: "$subjects" },
          { $group: { _id: "$subjects", count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ]),
        Teacher.aggregate([
          { $match: { schoolId: new Types.ObjectId(schoolId) } },
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
        Teacher.countDocuments({
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
    } catch (error) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to fetch teacher stats: ${(error as Error).message}`
      );
    }
  }

  async getTeacherPhotos(teacherId: string): Promise<ITeacherPhotoResponse[]> {
    try {
      if (!Types.ObjectId.isValid(teacherId)) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid teacher ID format");
      }

      const photos = await TeacherPhoto.find({ teacherId })
        .sort({ photoNumber: 1 })
        .lean();

      return photos.map((photo) => ({
        id: photo._id.toString(),
        photoPath: photo.photoPath,
        photoNumber: photo.photoNumber,
        filename: photo.filename,
        size: photo.size,
        createdAt: photo.createdAt!,
      }));
    } catch (error) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to fetch teacher photos: ${(error as Error).message}`
      );
    }
  }

  async getAvailablePhotoSlots(teacherId: string): Promise<number[]> {
    try {
      if (!Types.ObjectId.isValid(teacherId)) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid teacher ID format");
      }

      const teacher = await Teacher.findById(teacherId)
        .populate("userId", "firstName")
        .populate("schoolId", "name");

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      // Get teacher folder path
      const age =
        new Date().getFullYear() - new Date(teacher.dob).getFullYear();
      const joinDate = teacher.joinDate.toISOString().split("T")[0];

      const folderPath = await FileUtils.createTeacherPhotoFolder(
        (teacher.schoolId as any).name,
        {
          firstName: (teacher.userId as any).firstName,
          age,
          bloodGroup: teacher.bloodGroup,
          joinDate,
          teacherId: teacher.teacherId,
        }
      );

      return await FileUtils.getAvailablePhotoNumbers(folderPath);
    } catch (error) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to get available photo slots: ${(error as Error).message}`
      );
    }
  }

  private async formatTeacherResponse(teacher: any): Promise<ITeacherResponse> {
    const age = teacher.dob
      ? new Date().getFullYear() - new Date(teacher.dob).getFullYear()
      : 0;
    const totalExperience = teacher.experience?.totalYears || 0;

    // Handle subject conversion if they are ObjectIds
    let subjects = teacher.subjects || [];
    if (subjects.length > 0) {
      const subjectObjectIds = subjects.filter(
        (subject: any) =>
          typeof subject === "string" && /^[0-9a-fA-F]{24}$/.test(subject)
      );

      if (subjectObjectIds.length > 0) {
        try {
          const subjectDocs = await Subject.find({
            _id: {
              $in: subjectObjectIds.map((id: string) => new Types.ObjectId(id)),
            },
          }).select("name");

          const subjectMap = new Map(
            subjectDocs.map((doc) => [doc._id.toString(), doc.name])
          );

          subjects = subjects.map((subject: any) => {
            if (
              typeof subject === "string" &&
              /^[0-9a-fA-F]{24}$/.test(subject)
            ) {
              return subjectMap.get(subject) || subject;
            }
            return subject;
          });
        } catch (error) {
          console.warn("Failed to convert subject ObjectIds to names:", error);
          // If conversion fails, keep the original subjects
        }
      }
    }

    return {
      id: teacher._id?.toString() || teacher.id,
      userId: teacher.userId?._id?.toString() || teacher.userId?.toString(),
      schoolId:
        teacher.schoolId?._id?.toString() || teacher.schoolId?.toString(),
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
      user:
        teacher.userId || teacher.user
          ? {
              id: (
                teacher.userId?._id ||
                teacher.user?._id ||
                teacher.userId?.id ||
                teacher.user?.id
              )?.toString(),
              username: teacher.userId?.username || teacher.user?.username,
              firstName: teacher.userId?.firstName || teacher.user?.firstName,
              lastName: teacher.userId?.lastName || teacher.user?.lastName,
              fullName:
                `${
                  teacher.userId?.firstName || teacher.user?.firstName || ""
                } ${
                  teacher.userId?.lastName || teacher.user?.lastName || ""
                }`.trim() || "Unknown User",
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
      photos:
        teacher.photos?.map((photo: any) => ({
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

  // Teacher Dashboard Service Methods
  async getTeacherDashboard(userId: string): Promise<any> {
    try {
      // Find the teacher by userId
      const teacher = await Teacher.findOne({ userId })
        .populate("schoolId", "name")
        .populate("userId", "firstName lastName username");

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      // Get current date for today's statistics
      const today = new Date();
      const startOfDay = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      );
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

      // Calculate real dashboard statistics
      // totalClasses: grades × sections
      const totalClasses = teacher.grades.length * teacher.sections.length;

      // totalStudents: count students in teacher's grades/sections at their school
      const totalStudents = await Student.countDocuments({
        schoolId: teacher.schoolId,
        grade: { $in: teacher.grades },
        section: { $in: teacher.sections },
        isActive: true,
      });

      // pendingHomework: count homework assigned by this teacher that is not past due
      const now = new Date();
      const pendingHomework = await Homework.countDocuments({
        teacherId: teacher._id,
        dueDate: { $gte: now },
        isPublished: true,
      });

      // todayClasses: count of classes scheduled for this teacher today
      const schedules = await Schedule.find({
        "periods.teacherId": teacher._id,
        isActive: true,
      });
      let todayClasses = 0;
      const todayDayOfWeek = today
        .toLocaleString("en-US", { weekday: "long" })
        .toLowerCase();
      schedules.forEach((schedule: any) => {
        if (
          schedule.dayOfWeek &&
          schedule.dayOfWeek.toLowerCase() === todayDayOfWeek
        ) {
          // Count periods for this teacher today
          todayClasses += schedule.periods.filter(
            (p: any) => String(p.teacherId) === String(teacher._id)
          ).length;
        }
      });

      const dashboardData = {
        teacher: {
          id: teacher._id,
          name: `${(teacher.userId as any)?.firstName || ""} ${
            (teacher.userId as any)?.lastName || ""
          }`.trim(),
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
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to get teacher dashboard: ${(error as Error).message}`
      );
    }
  }

  async getTeacherSchedule(userId: string): Promise<any> {
    try {
      const teacher = await Teacher.findOne({ userId }).populate(
        "schoolId",
        "name"
      );

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      // Get schedules where this teacher is assigned
      const schedules = await Schedule.findByTeacher(teacher._id.toString());

      // Group schedules by day of week
      const weeklySchedule: { [key: string]: any[] } = {
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
        const teacherPeriods = schedule.getPeriodsForTeacher(
          teacher._id.toString()
        );

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
              id: (period.subjectId as any)?._id || period.subjectId,
              name: (period.subjectId as any)?.name || "Unknown Subject",
              code: (period.subjectId as any)?.code || "N/A",
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

      // Sort periods by time within each day
      Object.keys(weeklySchedule).forEach((day) => {
        weeklySchedule[day].sort((a, b) => {
          if (a.startTime < b.startTime) return -1;
          if (a.startTime > b.startTime) return 1;
          return a.periodNumber - b.periodNumber;
        });
      });

      // Get today's schedule
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

      // Find current period
      const currentTime = new Date();
      const currentTimeString = `${currentTime
        .getHours()
        .toString()
        .padStart(2, "0")}:${currentTime
        .getMinutes()
        .toString()
        .padStart(2, "0")}`;

      const currentPeriod = todaySchedule.find((period) => {
        return (
          currentTimeString >= period.startTime &&
          currentTimeString <= period.endTime
        );
      });

      const nextPeriod = todaySchedule.find((period) => {
        return currentTimeString < period.startTime;
      });

      return {
        teacher: {
          id: teacher._id,
          teacherId: teacher.teacherId,
          name: `${(teacher.userId as any)?.firstName || ""} ${
            (teacher.userId as any)?.lastName || ""
          }`.trim(),
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
          busyDays: Object.keys(weeklySchedule).filter(
            (day) => weeklySchedule[day].length > 0
          ).length,
        },
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to get teacher schedule: ${(error as Error).message}`
      );
    }
  }

  // Helper method to calculate duration between two time strings
  private calculateDuration(startTime: string, endTime: string): number {
    const [startHour, startMin] = startTime.split(":").map(Number);
    const [endHour, endMin] = endTime.split(":").map(Number);

    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    return endMinutes - startMinutes;
  }

  async getTeacherClasses(userId: string): Promise<any> {
    try {
      const teacher = await Teacher.findOne({ userId }).populate(
        "schoolId",
        "name"
      );

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      // Get schedules where this teacher is assigned
      const schedules = await Schedule.findByTeacher(teacher._id.toString());

      // Extract unique class combinations from schedules
      const classMap = new Map();

      schedules.forEach((schedule) => {
        // Get periods where this teacher is assigned
        const teacherPeriods = schedule.getPeriodsForTeacher(
          teacher._id.toString()
        );

        if (teacherPeriods.length > 0) {
          const classKey = `${schedule.grade}-${schedule.section}`;

          if (!classMap.has(classKey)) {
            classMap.set(classKey, {
              grade: schedule.grade,
              section: schedule.section,
              subjects: new Set(),
              totalPeriods: 0,
              daysScheduled: new Set(),
              studentsCount: 0, // TODO: Get actual count from student collection
              classId: schedule.classId,
            });
          }

          const classData = classMap.get(classKey);

          // Add subjects from teacher's periods
          teacherPeriods.forEach((period) => {
            if (period.subjectId) {
              // Add subject name from populated data or use the ID
              const subjectName =
                (period.subjectId as any)?.name ||
                teacher.subjects.find(
                  (s) => s === period.subjectId?.toString()
                ) ||
                period.subjectId.toString();
              classData.subjects.add(subjectName);
              classData.totalPeriods++;
            }
          });

          classData.daysScheduled.add(schedule.dayOfWeek);
        }
      });

      // Convert map to array and format the data
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

      // Sort classes by grade and then by section
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
          name: `${(teacher.userId as any)?.firstName || ""} ${
            (teacher.userId as any)?.lastName || ""
          }`.trim(),
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
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to get teacher classes: ${(error as Error).message}`
      );
    }
  }

  async getCurrentPeriods(userId: string): Promise<any> {
    try {
      const teacher = await Teacher.findOne({ userId }).populate(
        "schoolId userId"
      );

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      const now = new Date();
      const currentDay = now
        .toLocaleDateString("en-US", { weekday: "long" })
        .toLowerCase();
      const currentTime = now.toTimeString().substring(0, 5); // HH:MM format

      const schoolTimezone =
        ((teacher.schoolId as any)?.settings?.timezone as string | undefined) ||
        config.school_timezone ||
        "UTC";
      const { dateKey } = normaliseDateKey(now, schoolTimezone);
      const schoolId = (teacher.schoolId as any)?._id || teacher.schoolId;

      // Get today's schedule for the teacher
      const schedules = await Schedule.find({
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

      const availablePeriods: any[] = [];
      const currentPeriods: any[] = [];
      const upcomingPeriods: any[] = [];
      const holidayPeriods: any[] = [];

      for (const schedule of schedules) {
        const holidayEvents = await findHolidayEventsForClass({
          schoolId,
          dateKey,
          timezone: schoolTimezone,
          grade: schedule.grade,
          section: schedule.section,
        });

        const isHoliday = holidayEvents.length > 0;

        for (const period of schedule.periods) {
          if (
            period.teacherId?.toString() === teacher._id.toString() &&
            !period.isBreak
          ) {
            const status = this.getPeriodTimeStatus(
              period.startTime!,
              period.endTime!,
              now
            );
            const canMark =
              !isHoliday &&
              this.canMarkAttendanceNow(
                period.startTime!,
                period.endTime!,
                now
              );
            const periodData = {
              scheduleId: schedule._id,
              classId: schedule.classId._id || schedule.classId, // Ensure we get the ObjectId string
              grade: schedule.grade,
              section: schedule.section,
              className: `Grade ${schedule.grade} - Section ${schedule.section}`,
              periodNumber: period.periodNumber,
              subject: period.subjectId
                ? {
                    id: (period.subjectId as any)._id || period.subjectId,
                    name: (period.subjectId as any).name || "Unknown Subject",
                    code: (period.subjectId as any).code || "UNK",
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
            } else if (status === "upcoming") {
              upcomingPeriods.push(periodData);
            } else {
              availablePeriods.push(periodData);
            }
          }
        }
      }

      const holidayTitles = holidayPeriods
        .flatMap((period) =>
          period.holidayEvents.map((event) => event.title).filter(Boolean)
        )
        .filter(
          (value, index, array) => value && array.indexOf(value) === index
        );

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
          name: `${(teacher.userId as any).firstName} ${
            (teacher.userId as any).lastName
          }`,
          teacherId: teacher.teacherId,
        },
        currentTime: now.toISOString(),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to get current periods: ${(error as Error).message}`
      );
    }
  }

  // Check if attendance can be marked now for the given period
  private canMarkAttendanceNow(
    startTime: string,
    endTime: string,
    now: Date
  ): boolean {
    if (!startTime || !endTime) {
      return false; // Cannot mark attendance without valid time slots
    }

    const currentTime = now.toTimeString().substring(0, 5);

    // Allow attendance marking from 5 minutes before start time to end time
    const [startHour, startMin] = startTime.split(":").map(Number);
    const [endHour, endMin] = endTime.split(":").map(Number);
    const [currentHour, currentMin] = currentTime.split(":").map(Number);

    const startMinutes = startHour * 60 + startMin - 5; // 5 minutes early
    const endMinutes = endHour * 60 + endMin;
    const currentMinutes = currentHour * 60 + currentMin;

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  // Get period time status (upcoming, current, past)
  private getPeriodTimeStatus(
    startTime: string,
    endTime: string,
    now: Date
  ): "upcoming" | "current" | "past" {
    if (!startTime || !endTime) {
      return "upcoming"; // Default status if times are not available
    }

    const currentTime = now.toTimeString().substring(0, 5);

    const [startHour, startMin] = startTime.split(":").map(Number);
    const [endHour, endMin] = endTime.split(":").map(Number);
    const [currentHour, currentMin] = currentTime.split(":").map(Number);

    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    const currentMinutes = currentHour * 60 + currentMin;

    if (currentMinutes < startMinutes) return "upcoming";
    if (currentMinutes <= endMinutes) return "current";
    return "past";
  }

  async markAttendance(
    userId: string,
    attendanceData: {
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
    }
  ): Promise<any> {
    try {
      const teacher = await Teacher.findOne({ userId }).populate(
        "schoolId userId"
      );

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      const now = new Date();
      const currentDay = now
        .toLocaleDateString("en-US", { weekday: "long" })
        .toLowerCase();
      const attendanceDate = new Date(attendanceData.date);

      // Verify teacher has permission for this subject/grade/section
      const schedule = await Schedule.findOne({
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
        throw new AppError(
          httpStatus.FORBIDDEN,
          "You are not authorized to mark attendance for this class/subject/period"
        );
      }

      // Find the specific period
      const period = schedule.periods.find((p) => {
        // Handle both populated and non-populated subjectId
        let subjectId: string;
        if (
          p.subjectId &&
          typeof p.subjectId === "object" &&
          "_id" in p.subjectId
        ) {
          // If populated (object with _id)
          subjectId = (p.subjectId as any)._id.toString();
        } else if (p.subjectId) {
          // If not populated (just ObjectId)
          subjectId = String(p.subjectId);
        } else {
          subjectId = "";
        }

        return (
          p.periodNumber === attendanceData.period &&
          p.teacherId?.toString() === teacher._id.toString() &&
          subjectId === attendanceData.subjectId
        );
      });

      if (!period) {
        throw new AppError(
          httpStatus.FORBIDDEN,
          "Period not found in your schedule"
        );
      }

      // Verify current time is within the period window (allow marking until end time)
      if (!this.canMarkAttendanceNow(period.startTime!, period.endTime!, now)) {
        const timeStatus = this.getPeriodTimeStatus(
          period.startTime!,
          period.endTime!,
          now
        );
        if (timeStatus === "past") {
          throw new AppError(
            httpStatus.BAD_REQUEST,
            `Attendance marking window has closed. Period ended at ${period.endTime}`
          );
        } else {
          throw new AppError(
            httpStatus.BAD_REQUEST,
            `Attendance marking window has not started yet. Period starts at ${period.startTime}`
          );
        }
      }

      // Use the new Attendance.markAttendance static method
      const savedAttendance = await Attendance.markAttendance(
        teacher._id.toString(),
        attendanceData.classId,
        attendanceData.subjectId,
        attendanceDate,
        attendanceData.period,
        attendanceData.students
      );

      // Get attendance stats from the saved record
      const stats = savedAttendance.getAttendanceStats();

      // Get absent students for parent notification
      const absentStudents = savedAttendance.students.filter(
        (s) => s.status === "absent"
      );

      // Send notifications to parents of absent students
      if (absentStudents.length > 0) {
        try {
          for (const absentStudent of absentStudents) {
            await Notification.createAttendanceAlert({
              studentId: absentStudent.studentId.toString(),
              teacherId: teacher._id.toString(),
              subjectName: (period.subjectId as any).name,
              className: `Grade ${attendanceData.grade} - Section ${attendanceData.section}`,
              date: attendanceDate,
              period: attendanceData.period,
            });
          }
        } catch (notificationError) {
          console.error("Failed to send notifications:", notificationError);
          // Don't fail the attendance marking if notification fails
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
    } catch (error) {
      if (error instanceof AppError) throw error;

      if (error instanceof Error) {
        const message = error.message || "Failed to mark attendance";

        if (message.includes("locked")) {
          throw new AppError(httpStatus.FORBIDDEN, message);
        }

        if (message.includes("Cannot mark attendance")) {
          throw new AppError(httpStatus.BAD_REQUEST, message);
        }

        throw new AppError(
          httpStatus.INTERNAL_SERVER_ERROR,
          `Failed to mark attendance: ${message}`
        );
      }

      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to mark attendance due to an unexpected error"
      );
    }
  }

  async getStudentsForAttendance(
    userId: string,
    classId: string,
    subjectId: string,
    period: number
  ): Promise<any> {
    try {
      // Validate ObjectId parameters
      if (!classId || !Types.ObjectId.isValid(classId)) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid classId provided");
      }

      if (!subjectId || !Types.ObjectId.isValid(subjectId)) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          "Invalid subjectId provided"
        );
      }

      const teacher = await Teacher.findOne({ userId }).populate(
        "schoolId userId"
      );

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      // Verify teacher has permission to mark attendance for this class/subject/period
      const now = new Date();
      const currentDay = now
        .toLocaleDateString("en-US", { weekday: "long" })
        .toLowerCase();

      const schedule = await Schedule.findOne({
        schoolId: teacher.schoolId,
        classId: new Types.ObjectId(classId),
        dayOfWeek: currentDay,
        isActive: true,
        periods: {
          $elemMatch: {
            periodNumber: period,
            teacherId: teacher._id,
            subjectId: new Types.ObjectId(subjectId),
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
        throw new AppError(
          httpStatus.FORBIDDEN,
          "You are not authorized to mark attendance for this class/subject/period"
        );
      }

      // Get students from the specified class
      const students = await Student.find({
        schoolId: teacher.schoolId,
        grade: schedule.grade,
        section: schedule.section,
        isActive: true,
      })
        .populate("userId", "firstName lastName")
        .sort({ rollNumber: 1 });

      // Check if attendance already marked today
      const schoolTimezone =
        ((teacher.schoolId as any)?.settings?.timezone as string | undefined) ||
        config.school_timezone ||
        "UTC";
      const { date: attendanceDate, dateKey } = normaliseDateKey(
        now,
        schoolTimezone
      );
      const dateString = now.toISOString().split("T")[0]; // Use current date for display

      const schoolId = (teacher.schoolId as any)?._id || teacher.schoolId;
      const holidayEvents = await findHolidayEventsForClass({
        schoolId,
        dateKey,
        timezone: schoolTimezone,
        grade: schedule.grade,
        section: schedule.section,
      });

      if (holidayEvents.length) {
        const titles = holidayEvents
          .map((event) => event.title)
          .filter((title): title is string => Boolean(title));
        const label = titles.length ? ` (${titles.join(", ")})` : "";

        throw new AppError(
          httpStatus.FORBIDDEN,
          `Attendance cannot be taken on ${dateKey}; the school calendar marks this date as a holiday${label}.`
        );
      }

      const existingAttendance = await Attendance.findOne({
        teacherId: teacher._id,
        subjectId: new Types.ObjectId(subjectId),
        classId: new Types.ObjectId(classId),
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
      const dayAttendanceDocs = await StudentDayAttendance.find({
        schoolId: teacher.schoolId,
        dateKey,
        studentId: { $in: studentObjectIds },
      }).select(
        "studentId autoStatus teacherStatus finalStatus finalSource teacherOverride autoMarkedAt teacherMarkedAt finalized"
      );

      const dayAttendanceMap = new Map<
        string,
        (typeof dayAttendanceDocs)[number]
      >();
      dayAttendanceDocs.forEach((doc) => {
        dayAttendanceMap.set(doc.studentId.toString(), doc);
      });

      const studentsWithAttendance = students.map((student) => ({
        id: student._id.toString(),
        studentId: student.studentId,
        name: `${(student.userId as any).firstName} ${
          (student.userId as any).lastName
        }`,
        rollNumber: student.rollNumber,
        grade: student.grade,
        section: student.section,
        autoStatus:
          dayAttendanceMap.get(student._id.toString())?.autoStatus || null,
        finalStatus:
          dayAttendanceMap.get(student._id.toString())?.finalStatus || null,
        finalSource:
          dayAttendanceMap.get(student._id.toString())?.finalSource || null,
        teacherOverride:
          dayAttendanceMap.get(student._id.toString())?.teacherOverride ||
          false,
        currentStatus: attendanceMap.get(student._id.toString()) || null,
        hasPhoto: (student as any).photos && (student as any).photos.length > 0,
      }));

      const periodInfo = schedule.periods.find(
        (p) =>
          p.periodNumber === period &&
          p.teacherId?.toString() === teacher._id.toString() &&
          p.subjectId?.toString() === subjectId
      );

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
          canMarkAttendance: this.canMarkAttendanceNow(
            periodInfo?.startTime || "00:00",
            periodInfo?.endTime || "00:00",
            now
          ),
          timeStatus: this.getPeriodTimeStatus(
            periodInfo?.startTime || "00:00",
            periodInfo?.endTime || "00:00",
            now
          ),
        },
        students: studentsWithAttendance,
        attendanceAlreadyMarked: existingAttendance !== null,
        teacherInfo: {
          id: teacher._id,
          name: `${(teacher.userId as any).firstName} ${
            (teacher.userId as any).lastName
          }`,
        },
        date: dateString,
        dateKey,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to get students for attendance: ${(error as Error).message}`
      );
    }
  }

  // Get students for attendance based on teacher's current schedule (simplified)
  async getMyStudentsForAttendance(userId: string): Promise<any> {
    try {
      const teacher = await Teacher.findOne({ userId }).populate(
        "schoolId userId"
      );

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      const now = new Date();
      const currentDay = now
        .toLocaleDateString("en-US", { weekday: "long" })
        .toLowerCase();

      // Get all schedules for this teacher for today
      const schedules = await Schedule.find({
        schoolId: teacher.schoolId,
        dayOfWeek: currentDay,
        isActive: true,
        "periods.teacherId": teacher._id,
      }).populate("classId");

      const schoolTimezone =
        ((teacher.schoolId as any)?.settings?.timezone as string | undefined) ||
        config.school_timezone ||
        "UTC";
      const { dateKey } = normaliseDateKey(now, schoolTimezone);
      const schoolId = (teacher.schoolId as any)?._id || teacher.schoolId;

      const classesWithStudents: any[] = [];
      const holidayClasses: any[] = [];

      for (const schedule of schedules) {
        const holidayEvents = await findHolidayEventsForClass({
          schoolId,
          dateKey,
          timezone: schoolTimezone,
          grade: schedule.grade,
          section: schedule.section,
        });

        let students = await Student.find({
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
            name: `${(student.userId as any).firstName} ${
              (student.userId as any).lastName
            }`,
            profilePhoto: (student.userId as any).profilePhoto,
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
        .flatMap((cls) =>
          cls.holidayEvents.map((event) => event.title).filter(Boolean)
        )
        .filter(
          (value, index, array) => value && array.indexOf(value) === index
        );

      return {
        teacherInfo: {
          id: teacher._id,
          name: `${(teacher.userId as any).firstName} ${
            (teacher.userId as any).lastName
          }`,
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
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to get students for attendance: ${(error as Error).message}`
      );
    }
  }

  async assignHomework(
    userId: string,
    homeworkData: any,
    attachments?: Express.Multer.File[]
  ): Promise<any> {
    try {
      const teacher = await Teacher.findOne({ userId }).populate("schoolId");

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      // Upload attachments to Cloudinary if provided
      let attachmentUrls: string[] = [];
      if (attachments && attachments.length > 0) {
        try {
          const { uploadToCloudinary } = await import(
            "../../utils/cloudinaryUtils"
          );

          for (const file of attachments) {
            const uploadResult = await uploadToCloudinary(file.buffer, {
              folder: "homework-attachments",
              resource_type: "auto",
              use_filename: true,
              unique_filename: true,
            });
            attachmentUrls.push(uploadResult.secure_url);
          }
        } catch (error) {
          throw new AppError(
            httpStatus.INTERNAL_SERVER_ERROR,
            "Failed to upload attachments"
          );
        }
      }

      // Import Homework model
      const { Homework } = await import("../homework/homework.model");

      // Create homework data
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

      // Populate the homework with related data
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

      // Send notifications to parents about homework assignment
      if (homework.isPublished) {
        try {
          // Get students from the specified grade and section
          const students = await Student.find({
            schoolId: teacher.schoolId,
            grade: homework.grade,
            ...(homework.section ? { section: homework.section } : {}),
            isActive: true,
          });

          const studentIds = students.map((s) => s._id.toString());

          if (studentIds.length > 0) {
            await Notification.createHomeworkAlert({
              studentIds: studentIds,
              teacherId: teacher._id.toString(),
              homeworkTitle: homework.title,
              dueDate: homework.dueDate,
              subjectName:
                (populatedHomework?.subjectId as any)?.name ||
                "Unknown Subject",
            });
          }
        } catch (notificationError) {
          console.error(
            "Failed to send homework notifications:",
            notificationError
          );
          // Don't fail the homework assignment if notification fails
        }
      }

      return {
        id: homework._id,
        ...populatedHomework?.toJSON(),
        message: "Homework assigned successfully",
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to assign homework: ${(error as Error).message}`
      );
    }
  }

  async getMyHomeworkAssignments(userId: string, filters?: any): Promise<any> {
    try {
      const teacher = await Teacher.findOne({ userId });

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      // Import Homework model
      const { Homework } = await import("../homework/homework.model");

      // Create query for teacher's homework
      const query: any = { teacherId: teacher._id };

      // Apply filters
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

      // Date range filter
      if (filters?.startDate || filters?.endDate) {
        query.dueDate = {};
        if (filters.startDate) {
          query.dueDate.$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          query.dueDate.$lte = new Date(filters.endDate);
        }
      }

      // Get homework assignments sorted by createdAt/updatedAt (newest first)
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
        .sort({ updatedAt: -1, createdAt: -1 }) // Newest first as requested
        .lean();

      // Add submission stats for each homework
      const assignmentsWithStats = await Promise.all(
        assignments.map(async (assignment) => {
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
        })
      );

      // Calculate summary statistics
      const summary = {
        total: assignments.length,
        published: assignments.filter((a) => a.isPublished).length,
        draft: assignments.filter((a) => !a.isPublished).length,
        overdue: assignmentsWithStats.filter((a) => a.isOverdue).length,
        dueToday: assignmentsWithStats.filter((a) => a.isDueToday).length,
        upcoming: assignmentsWithStats.filter(
          (a) => a.daysUntilDue > 0 && a.daysUntilDue <= 7
        ).length,
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
          presentation: assignments.filter(
            (a) => a.homeworkType === "presentation"
          ).length,
          other: assignments.filter((a) => a.homeworkType === "other").length,
        },
      };

      return {
        teacherId: teacher._id,
        assignments: assignmentsWithStats,
        summary,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to get homework assignments: ${(error as Error).message}`
      );
    }
  }

  async issueWarning(userId: string, warningData: any): Promise<any> {
    try {
      const teacher = await Teacher.findOne({ userId }).populate("schoolId");

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      const { DisciplinaryAction } = await import(
        "../disciplinary/disciplinary.model"
      );

      // Create disciplinary action for each selected student
      const actions: any[] = [];

      for (const studentId of warningData.studentIds) {
        // Verify teacher has permission for the student (basic check)
        const student = await Student.findById(studentId);
        if (
          !student ||
          student.schoolId.toString() !== teacher.schoolId._id.toString()
        ) {
          throw new AppError(
            httpStatus.FORBIDDEN,
            `You don't have permission for student ${studentId}`
          );
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
          points:
            warningData.points ||
            (warningData.severity === "high"
              ? 10
              : warningData.severity === "medium"
              ? 5
              : 2),
          warrantLevel: warningData.warrantLevel,
          isRedWarrant: warningData.actionType === "red_warrant",
          academicYear:
            new Date().getFullYear() + "-" + (new Date().getFullYear() + 1),
          createdBy: teacher.userId,
        });

        // Send notifications if requested
        if (warningData.notifyParents) {
          try {
            await (action as any).notifyParents();
          } catch (error) {
            console.error("Failed to notify parents:", error);
          }
        }
        try {
          await (action as any).notifyStudent();
        } catch (error) {
          console.error("Failed to notify student:", error);
        }

        actions.push(action);
      }

      return {
        success: true,
        actionsCreated: actions.length,
        actions: actions.map((action) => ({
          id: (action._id as any)?.toString() || action.id,
          studentId: action.studentId,
          actionType: action.actionType,
          severity: action.severity,
          title: action.title,
          isRedWarrant: action.isRedWarrant,
          issuedAt: action.issuedDate,
        })),
        teacherId: teacher._id,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to issue warning: ${(error as Error).message}`
      );
    }
  }

  async issuePunishment(userId: string, punishmentData: any): Promise<any> {
    try {
      const teacher = await Teacher.findOne({ userId }).populate("schoolId");

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      const { DisciplinaryAction } = await import(
        "../disciplinary/disciplinary.model"
      );

      // Create red warrant type punishment for each student
      const actions: any[] = [];

      for (const studentId of punishmentData.studentIds) {
        // Verify teacher has permission
        const student = await Student.findById(studentId);
        if (
          !student ||
          student.schoolId.toString() !== teacher.schoolId._id.toString()
        ) {
          throw new AppError(
            httpStatus.FORBIDDEN,
            `You don't have permission for student ${studentId}`
          );
        }

        // Validate required fields
        if (!punishmentData.reason || punishmentData.reason.trim() === "") {
          throw new AppError(
            httpStatus.BAD_REQUEST,
            "Reason is required for disciplinary action"
          );
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
          followUpDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
          isAppealable: punishmentData.isAppealable !== false,
          appealDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          witnesses: punishmentData.witnesses || [],
          evidenceAttachments: punishmentData.evidenceAttachments || [],
          points: punishmentData.severity === "critical" ? 50 : 30,
          warrantLevel: "red",
          isRedWarrant: true,
          academicYear:
            new Date().getFullYear() + "-" + (new Date().getFullYear() + 1),
          createdBy: teacher.userId,
        });

        // Send urgent notifications to both parents and students
        try {
          await (action as any).notifyParents();
          await (action as any).notifyStudent();
        } catch (error) {
          console.error("Failed to send notifications:", error);
        }

        actions.push(action);
      }

      return {
        success: true,
        redWarrantsIssued: actions.length,
        actions: actions.map((action) => ({
          id: (action._id as any)?.toString() || action.id,
          studentId: action.studentId,
          warrantNumber: `RW-${Date.now()}-${(
            (action._id as any)?.toString() || ""
          )
            .slice(-6)
            .toUpperCase()}`,
          severity: action.severity,
          title: action.title,
          issuedAt: action.issuedDate,
        })),
        teacherId: teacher._id,
        urgentNotificationsSent: true,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to issue punishment: ${(error as Error).message}`
      );
    }
  }

  async getMyDisciplinaryActions(userId: string, filters?: any): Promise<any> {
    try {
      const teacher = await Teacher.findOne({ userId });

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      const { DisciplinaryAction } = await import(
        "../disciplinary/disciplinary.model"
      );

      const query: any = { teacherId: teacher._id };

      // Apply filters
      if (filters?.actionType) query.actionType = filters.actionType;
      if (filters?.severity) query.severity = filters.severity;
      if (filters?.status) query.status = filters.status;
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

      const stats = await DisciplinaryAction.getDisciplinaryStats(
        teacher.schoolId.toString(),
        { teacherId: teacher._id }
      );

      return {
        teacherId: teacher._id,
        actions: actions.map((action: any) => {
          const student = action.studentId as any;
          const user = student?.userId as any;
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
            canAppeal: (action as any).canAppeal
              ? (action as any).canAppeal()
              : false,
            isOverdue: (action as any).isOverdue
              ? (action as any).isOverdue()
              : false,
          };
        }),
        stats,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to get disciplinary actions: ${(error as Error).message}`
      );
    }
  }

  async resolveDisciplinaryAction(
    userId: string,
    actionId: string,
    resolutionNotes: string
  ): Promise<any> {
    try {
      const teacher = await Teacher.findOne({ userId });

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      const { DisciplinaryAction } = await import(
        "../disciplinary/disciplinary.model"
      );

      const action = await DisciplinaryAction.findById(actionId);

      if (!action) {
        throw new AppError(
          httpStatus.NOT_FOUND,
          "Disciplinary action not found"
        );
      }

      // Check if teacher has permission to resolve this action
      if (action.teacherId.toString() !== teacher._id.toString()) {
        throw new AppError(
          httpStatus.FORBIDDEN,
          "You can only resolve your own disciplinary actions"
        );
      }

      // Update the action directly
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
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to resolve disciplinary action: ${(error as Error).message}`
      );
    }
  }

  async addDisciplinaryActionComment(
    userId: string,
    actionId: string,
    comment: string
  ): Promise<any> {
    try {
      const teacher = await Teacher.findOne({ userId });

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      const { DisciplinaryAction } = await import(
        "../disciplinary/disciplinary.model"
      );

      const action = await DisciplinaryAction.findById(actionId);

      if (!action) {
        throw new AppError(
          httpStatus.NOT_FOUND,
          "Disciplinary action not found"
        );
      }

      // Check if teacher has permission to comment on this action
      if (action.teacherId.toString() !== teacher._id.toString()) {
        throw new AppError(
          httpStatus.FORBIDDEN,
          "You can only comment on your own disciplinary actions"
        );
      }

      // Add follow-up comment
      action.resolutionNotes =
        (action.resolutionNotes || "") + "\n\nFollow-up: " + comment;
      action.followUpDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days from now
      const updatedAction = await action.save();

      return {
        id: updatedAction._id,
        followUpDate: updatedAction.followUpDate,
        resolutionNotes: updatedAction.resolutionNotes,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to add comment to disciplinary action: ${
          (error as Error).message
        }`
      );
    }
  }

  async getStudentsByGrade(
    userId: string,
    grade: number,
    section?: string
  ): Promise<any> {
    try {
      const teacher = await Teacher.findOne({ userId }).populate("schoolId");

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      // For disciplinary actions, allow more flexible access
      // Check if this is being called for disciplinary purposes (we can add a parameter later)
      // For now, let's allow teachers to access students if they teach in the same school
      const teacherSchedules = await Schedule.find({
        schoolId: teacher.schoolId,
        "periods.teacherId": teacher._id,
        isActive: true,
      });

      // Get all grades this teacher teaches
      const teacherGrades = new Set([
        ...teacher.grades,
        ...teacherSchedules.map((s) => s.grade),
      ]);

      // If teacher doesn't have direct access to this grade, but has general teaching access in the school,
      // allow access for disciplinary purposes (teachers can report incidents about any student in school)
      const hasGeneralAccess =
        teacher.designation === "head_teacher" ||
        teacher.designation === "assistant_head_teacher" ||
        teacher.designation === "discipline_master" ||
        teacherGrades.size > 0; // Has at least some teaching responsibilities

      if (!teacherGrades.has(grade) && !hasGeneralAccess) {
        throw new AppError(
          httpStatus.FORBIDDEN,
          `You don't have permission to access Grade ${grade}`
        );
      }

      const query: any = {
        schoolId: teacher.schoolId._id,
        grade,
        isActive: true,
      };

      if (section) {
        // Verify teacher has permission for this section
        if (!teacher.sections.includes(section)) {
          throw new AppError(
            httpStatus.FORBIDDEN,
            `You don't have permission to access Section ${section}`
          );
        }
        query.section = section;
      }

      const students = await Student.find(query)
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

      // Get disciplinary history for each student
      const { DisciplinaryAction } = await import(
        "../disciplinary/disciplinary.model"
      );

      const studentsWithStats = await Promise.all(
        students.map(async (student) => {
          const disciplinaryHistory =
            await DisciplinaryAction.getStudentDisciplinaryHistory(
              student._id.toString()
            );

          const user = student.userId as any;
          const parent = student.parentId as any;
          const parentUser = parent?.userId as any;

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
              lastActionDate:
                disciplinaryHistory.recentActions[0]?.issuedDate || null,
              riskLevel:
                disciplinaryHistory.totalPoints > 40
                  ? "high"
                  : disciplinaryHistory.totalPoints > 20
                  ? "medium"
                  : "low",
            },
            hasPhotos: false, // TODO: Check if student has photos
          };
        })
      );

      // Calculate class statistics
      const classStats = {
        totalStudents: students.length,
        studentsWithDisciplinaryActions: studentsWithStats.filter(
          (s) => s.disciplinaryHistory.totalActions > 0
        ).length,
        studentsWithActiveWarnings: studentsWithStats.filter(
          (s) => s.disciplinaryHistory.activeWarnings > 0
        ).length,
        studentsWithRedWarrants: studentsWithStats.filter(
          (s) => s.disciplinaryHistory.redWarrants > 0
        ).length,
        highRiskStudents: studentsWithStats.filter(
          (s) => s.disciplinaryHistory.riskLevel === "high"
        ).length,
        averageDisciplinaryPoints:
          studentsWithStats.reduce(
            (sum, s) => sum + s.disciplinaryHistory.totalPoints,
            0
          ) / students.length,
      };

      return {
        teacherInfo: {
          id: teacher._id,
          teacherId: teacher.teacherId,
          name: teacher.userId
            ? `${(teacher.userId as any).firstName} ${
                (teacher.userId as any).lastName
              }`
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
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to get students by grade: ${(error as Error).message}`
      );
    }
  }

  async getMyGradingTasks(userId: string): Promise<any> {
    try {
      const teacher = await Teacher.findOne({ userId }).populate("schoolId");

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      const now = new Date();
      const currentAcademicYear = `${now.getFullYear()}-${
        now.getFullYear() + 1
      }`;

      // Import required models
      const { Exam } = await import("../exam/exam.model");
      const { AcademicCalendar } = await import(
        "../academic-calendar/academic-calendar.model"
      );
      const { Grade } = await import("../grade/grade.model");

      // TEMPORARILY SIMPLIFIED - Academic calendar integration needs proper schema
      // Get exams assigned to this teacher from academic calendar
      const academicExams: any[] = []; // TODO: Fix academic calendar integration
      /*
      const academicExams = await AcademicCalendar.find({
        schoolId: teacher.schoolId._id,
        eventType: 'exam',
        isActive: true,
        $or: [
          { 'targetAudience.grades': { $in: teacher.grades } },
          { 'targetAudience.teacherIds': teacher._id }
        ],
        startDate: { $lte: now }, // Exam has started or completed
        'examSchedule.teacherId': teacher._id
      }).populate('examSchedule.subjectId', 'name code');
      */

      // Get regular exams assigned to teacher
      const regularExams = await Exam.find({
        schoolId: teacher.schoolId._id,
        teacherId: teacher._id,
        academicYear: currentAcademicYear,
        examDate: { $lte: now }, // Exam date has passed
        status: { $in: ["completed", "grading"] },
      }).populate("subjectId", "name code");

      const gradingTasks: any[] = [];

      // Process academic calendar exams (simplified for now)
      // TODO: Properly implement when academic calendar schema is finalized
      /*
      for (const academicExam of academicExams) {
        for (const examItem of academicExam.examSchedule) {
          if (examItem.teacherId?.toString() === teacher._id.toString()) {
            // Check if grading is already completed
            const existingGrades = await Grade.countDocuments({
              teacherId: teacher._id,
              subjectId: examItem.subjectId,
              gradeType: 'exam',
              title: academicExam.title,
              academicYear: currentAcademicYear
            });

            // Get students for this grade/section
            const studentsQuery: any = {
              schoolId: teacher.schoolId._id,
              grade: examItem.grade || teacher.grades[0], // Use exam grade or teacher's first grade
              isActive: true
            };
            
            if (examItem.section) {
              studentsQuery.section = examItem.section;
            }

            const students = await Student.countDocuments(studentsQuery);
            const pendingGrades = students - existingGrades;

            if (pendingGrades > 0) {
              gradingTasks.push({
                id: `${academicExam._id}-${examItem._id}`,
                examId: academicExam._id,
                examItemId: examItem._id,
                examName: academicExam.title,
                examType: academicExam.eventType,
                subject: examItem.subjectId,
                grade: examItem.grade || teacher.grades[0],
                section: examItem.section,
                examDate: examItem.date || academicExam.startDate,
                totalMarks: examItem.totalMarks || 100,
                passingMarks: examItem.passingMarks || 40,
                duration: examItem.duration || 120,
                totalStudents: students,
                gradedStudents: existingGrades,
                pendingGrades,
                gradingStatus: existingGrades === 0 ? 'not_started' : 
                              pendingGrades === 0 ? 'completed' : 'in_progress',
                deadline: new Date(academicExam.endDate.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 days after exam end
                isOverdue: now > new Date(academicExam.endDate.getTime() + 7 * 24 * 60 * 60 * 1000),
                priority: now > new Date(academicExam.endDate.getTime() + 5 * 24 * 60 * 60 * 1000) ? 'high' : 'medium',
                source: 'academic_calendar',
                canGrade: true,
              });
            }
          }
        }
      }
      */

      // Process regular exams
      for (const exam of regularExams) {
        const existingGrades = await Grade.countDocuments({
          teacherId: teacher._id,
          subjectId: exam.subjectId,
          gradeType: "exam",
          title: exam.examName,
          academicYear: currentAcademicYear,
        });

        const studentsQuery: any = {
          schoolId: teacher.schoolId._id,
          grade: exam.grade,
          isActive: true,
        };

        if (exam.section) {
          studentsQuery.section = exam.section;
        }

        const students = await Student.countDocuments(studentsQuery);
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
            gradingStatus:
              existingGrades === 0
                ? "not_started"
                : pendingGrades === 0
                ? "completed"
                : "in_progress",
            deadline: new Date(
              exam.examDate.getTime() + 7 * 24 * 60 * 60 * 1000
            ), // 7 days after exam
            isOverdue:
              now > new Date(exam.examDate.getTime() + 7 * 24 * 60 * 60 * 1000),
            priority:
              now > new Date(exam.examDate.getTime() + 5 * 24 * 60 * 60 * 1000)
                ? "high"
                : "medium",
            source: "exam",
            canGrade: true,
          });
        }
      }

      // Sort by priority and deadline
      gradingTasks.sort((a, b) => {
        if (a.priority === "high" && b.priority !== "high") return -1;
        if (b.priority === "high" && a.priority !== "high") return 1;
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      });

      const stats = {
        totalTasks: gradingTasks.length,
        notStarted: gradingTasks.filter(
          (t) => t.gradingStatus === "not_started"
        ).length,
        inProgress: gradingTasks.filter(
          (t) => t.gradingStatus === "in_progress"
        ).length,
        completed: gradingTasks.filter((t) => t.gradingStatus === "completed")
          .length,
        overdue: gradingTasks.filter((t) => t.isOverdue).length,
        highPriority: gradingTasks.filter((t) => t.priority === "high").length,
        totalPendingGrades: gradingTasks.reduce(
          (sum, t) => sum + t.pendingGrades,
          0
        ),
      };

      return {
        teacherId: teacher._id,
        gradingTasks,
        stats,
        academicYear: currentAcademicYear,
        lastUpdated: now.toISOString(),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to get grading tasks: ${(error as Error).message}`
      );
    }
  }

  async getExamGradingDetails(
    userId: string,
    examId: string,
    examItemId?: string
  ): Promise<any> {
    try {
      const teacher = await Teacher.findOne({ userId }).populate("schoolId");

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      let examDetails: any;
      let studentsQuery: any;
      let subjectInfo: any;

      if (examItemId) {
        // TEMPORARILY DISABLED - Academic calendar integration needs proper schema
        /*
        // This is from academic calendar
        const { AcademicCalendar } = await import('../academic-calendar/academic-calendar.model');
        const academicExam = await AcademicCalendar.findById(examId);
        
        if (!academicExam) {
          throw new AppError(httpStatus.NOT_FOUND, "Exam not found");
        }

        const examItem = academicExam.examSchedule.find(e => e._id?.toString() === examItemId);
        if (!examItem || examItem.teacherId?.toString() !== teacher._id.toString()) {
          throw new AppError(httpStatus.FORBIDDEN, "You are not assigned to grade this exam");
        }

        examDetails = {
          examId,
          examItemId,
          examName: academicExam.title,
          examType: academicExam.eventType,
          grade: examItem.grade || teacher.grades[0],
          section: examItem.section,
          examDate: examItem.date || academicExam.startDate,
          totalMarks: examItem.totalMarks || 100,
          passingMarks: examItem.passingMarks || 40,
          duration: examItem.duration || 120,
          subject: examItem.subjectId,
        };

        studentsQuery = {
          schoolId: teacher.schoolId._id,
          grade: examDetails.grade,
          isActive: true
        };

        if (examDetails.section) {
          studentsQuery.section = examDetails.section;
        }

        subjectInfo = examItem.subjectId;
        */
        throw new AppError(
          httpStatus.NOT_IMPLEMENTED,
          "Academic calendar exam grading temporarily disabled"
        );
      } else {
        // This is from regular exam
        const { Exam } = await import("../exam/exam.model");
        const exam = await Exam.findById(examId).populate("subjectId");

        if (!exam || exam.teacherId?.toString() !== teacher._id.toString()) {
          throw new AppError(
            httpStatus.FORBIDDEN,
            "You are not assigned to grade this exam"
          );
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

      // Get students for grading
      const students = await Student.find(studentsQuery)
        .populate("userId", "firstName lastName")
        .sort({ rollNumber: 1 });

      // Get existing grades
      const { Grade } = await import("../grade/grade.model");
      const existingGrades = await Grade.find({
        teacherId: teacher._id,
        subjectId: subjectInfo._id || subjectInfo,
        gradeType: "exam",
        title: examDetails.examName,
        academicYear:
          new Date().getFullYear() + "-" + (new Date().getFullYear() + 1),
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
        const user = student.userId as any;
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
        averageMarks:
          existingGrades.length > 0
            ? existingGrades.reduce((sum, g) => sum + g.marksObtained, 0) /
              existingGrades.length
            : 0,
        passedStudents: existingGrades.filter(
          (g) =>
            g.percentage >=
            (examDetails.passingMarks / examDetails.totalMarks) * 100
        ).length,
        failedStudents: existingGrades.filter(
          (g) =>
            g.percentage <
            (examDetails.passingMarks / examDetails.totalMarks) * 100
        ).length,
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
          A: `${
            Math.ceil(
              (examDetails.passingMarks / examDetails.totalMarks) * 100
            ) + 20
          }-100`,
          B: `${
            Math.ceil(
              (examDetails.passingMarks / examDetails.totalMarks) * 100
            ) + 10
          }-${
            Math.ceil(
              (examDetails.passingMarks / examDetails.totalMarks) * 100
            ) + 19
          }`,
          C: `${Math.ceil(
            (examDetails.passingMarks / examDetails.totalMarks) * 100
          )}-${
            Math.ceil(
              (examDetails.passingMarks / examDetails.totalMarks) * 100
            ) + 9
          }`,
          D: `${
            Math.ceil(
              (examDetails.passingMarks / examDetails.totalMarks) * 100
            ) - 10
          }-${
            Math.ceil(
              (examDetails.passingMarks / examDetails.totalMarks) * 100
            ) - 1
          }`,
          F: `0-${
            Math.ceil(
              (examDetails.passingMarks / examDetails.totalMarks) * 100
            ) - 11
          }`,
        },
        canSubmitGrades: true,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to get exam grading details: ${(error as Error).message}`
      );
    }
  }

  async submitGrades(userId: string, gradesData: any): Promise<any> {
    try {
      const teacher = await Teacher.findOne({ userId });

      if (!teacher) {
        throw new AppError(httpStatus.NOT_FOUND, "Teacher not found");
      }

      const { Grade } = await import("../grade/grade.model");
      const currentAcademicYear =
        new Date().getFullYear() + "-" + (new Date().getFullYear() + 1);

      // Verify teacher is assigned to the exam/subject
      const { examId, examItemId, examName, subjectId, grades } = gradesData;

      if (examItemId) {
        // TEMPORARILY DISABLED - Academic calendar integration needs proper schema
        // This is from academic calendar - verify assignment
        /*
        const { AcademicCalendar } = await import('../academic-calendar/academic-calendar.model');
        const academicExam = await AcademicCalendar.findById(examId);
        
        if (!academicExam) {
          throw new AppError(httpStatus.NOT_FOUND, "Exam not found");
        }

        const examItem = academicExam.examSchedule.find(e => e._id?.toString() === examItemId);
        if (!examItem || examItem.teacherId?.toString() !== teacher._id.toString()) {
          throw new AppError(httpStatus.FORBIDDEN, "You are not assigned to grade this exam");
        }
        */
      } else {
        // This is from regular exam - verify assignment
        const { Exam } = await import("../exam/exam.model");
        const exam = await Exam.findById(examId);

        if (!exam || exam.teacherId?.toString() !== teacher._id.toString()) {
          throw new AppError(
            httpStatus.FORBIDDEN,
            "You are not assigned to grade this exam"
          );
        }
      }

      const submittedGrades: any[] = [];
      const errors: any[] = [];

      // Process each grade submission
      for (const gradeData of grades) {
        try {
          // Check if grade already exists
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
            percentage:
              gradeData.percentage ||
              (gradeData.obtainedMarks / (gradeData.totalMarks || 100)) * 100,
            grade: gradeData.grade,
            weightage: gradeData.weightage || 100, // Full weightage for exams
            gradedDate: new Date(),
          };

          if (existingGrade) {
            // Update existing grade
            Object.assign(existingGrade, gradeInfo);
            await existingGrade.save();
            submittedGrades.push({
              studentId: gradeData.studentId,
              action: "updated",
              gradeId: existingGrade._id,
            });
          } else {
            // Create new grade
            const newGrade = await Grade.create(gradeInfo);
            submittedGrades.push({
              studentId: gradeData.studentId,
              action: "created",
              gradeId: newGrade._id,
            });
          }

          // Send notification to student and parent about grade publication
          try {
            const { Notification } = await import(
              "../notification/notification.model"
            );
            const student = await Student.findById(
              gradeData.studentId
            ).populate([
              { path: "userId", select: "firstName lastName" },
              {
                path: "parentId",
                select: "userId",
                populate: { path: "userId", select: "_id" },
              },
            ]);

            if (student) {
              const studentUser = student.userId as any;
              const parentInfo = student.parentId as any;
              const parentUser = parentInfo?.userId as any;

              // Notify student
              await Notification.create({
                schoolId: teacher.schoolId,
                recipientId: studentUser._id,
                recipientType: "student",
                senderId: teacher.userId,
                senderType: "teacher",
                type: "grade_published",
                title: `Grade Published: ${examName}`,
                message: `Your exam grade has been published for ${examName}. Marks: ${
                  gradeData.obtainedMarks
                }/${gradeData.totalMarks || 100} (${gradeData.grade})`,
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

              // Notify parent if exists
              if (parentInfo && parentUser) {
                await Notification.create({
                  schoolId: teacher.schoolId,
                  recipientId: parentUser._id,
                  recipientType: "parent",
                  senderId: teacher.userId,
                  senderType: "teacher",
                  type: "grade_published",
                  title: `Grade Published: ${studentUser.firstName}'s ${examName}`,
                  message: `${
                    studentUser.firstName
                  }'s exam grade has been published for ${examName}. Marks: ${
                    gradeData.obtainedMarks
                  }/${gradeData.totalMarks || 100} (${gradeData.grade})`,
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
          } catch (notificationError) {
            console.error(
              "Failed to send grade notification:",
              notificationError
            );
            // Don't fail grade submission if notification fails
          }
        } catch (error) {
          errors.push({
            studentId: gradeData.studentId,
            error: (error as Error).message,
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
        message:
          errors.length === 0
            ? `Successfully submitted grades for ${stats.successful} students`
            : `Submitted ${stats.successful} grades with ${stats.failed} errors`,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to submit grades: ${(error as Error).message}`
      );
    }
  }
}

export const teacherService = new TeacherService();
