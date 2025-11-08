import httpStatus from "http-status";
import mongoose, { Types } from "mongoose";
import path from "path";
import { AppError } from "../../errors/AppError";
import { School } from "../school/school.model";
import { User } from "../user/user.model";
import { Parent } from "../parent/parent.model";
import { Student, StudentPhoto } from "./student.model";
import { Attendance } from "../attendance/attendance.model";
import { StudentDayAttendance } from "../attendance/day-attendance.model";
import { Assessment } from "../assessment/assessment.model";
import { assessmentService } from "../assessment/assessment.service";
import { Homework } from "../homework/homework.model";
import { Schedule } from "../schedule/schedule.model";
import { AcademicCalendar } from "../academic-calendar/academic-calendar.model";
import { UserCredentials } from "../user/userCredentials.model";
import { FileUtils } from "../../utils/fileUtils";
import { CredentialGenerator } from "../../utils/credentialGenerator";
import {
  generateCloudinaryFolderPath,
  uploadPhotosToCloudinary,
  deleteFromCloudinary,
} from "../../utils/cloudinaryUtils";

import config from "../../config";
import {
  ICreateStudentRequest,
  IUpdateStudentRequest,
  IStudentResponse,
  IStudentStats,
  IStudentPhotoResponse,
} from "./student.interface";

class StudentService {
  private deriveGradeLetter(percentage: number): string {
    if (percentage >= 90) return "A+";
    if (percentage >= 80) return "A";
    if (percentage >= 70) return "B+";
    if (percentage >= 60) return "B";
    if (percentage >= 50) return "C";
    if (percentage >= 40) return "D";
    return "F";
  }

  // Helper method to get event colors
  private getEventColor(eventType: string): string {
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

  async createStudent(
    studentData: ICreateStudentRequest,
    photos?: Express.Multer.File[],
    adminUserId?: string
  ): Promise<IStudentResponse> {
    const session = await mongoose.startSession();
    const uploadedPublicIds: string[] = [];
    let storedCredentialIds: Types.ObjectId[] = [];
    let schoolDoc: typeof School.prototype | null = null;
    let studentDoc: any = null;
    let studentUserDoc: any = null;
    let parentUserDocs: any[] = [];
    let createdParentDoc: any = null;
    let existingParentDoc: any = null;
    let parentWasExisting = false;
    let credentials:
      | {
          student: any;
          parent: any;
        }
      | undefined = undefined;

    // Photos are mandatory for registration – validate before any DB work
    if (!photos || photos.length === 0) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Photos are required for student registration. Please upload at least 3 photos."
      );
    }

    if (photos.length < 3) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Minimum 3 photos required for student registration"
      );
    }

    if (photos.length > 8) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Maximum 8 photos allowed per student"
      );
    }

    for (const photo of photos) {
      if (!photo.mimetype || !photo.originalname) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          "Invalid photo file. Each photo must have mimetype and original filename."
        );
      }

      if (!photo.mimetype.startsWith("image/")) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          "Only image files are allowed for student photos"
        );
      }
    }

    try {
      session.startTransaction();

      // Verify school exists and is active
      schoolDoc = await School.findById(studentData.schoolId).session(
        session
      );
      if (!schoolDoc) {
        throw new AppError(httpStatus.NOT_FOUND, "School not found");
      }

      if (schoolDoc.status !== "active") {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          "Cannot create student for inactive school"
        );
      }

      // Check if student with same name exists in the same grade/section
      const existingUser = await User.findOne({
        schoolId: studentData.schoolId,
        firstName: { $regex: new RegExp(`^${studentData.firstName}$`, "i") },
        lastName: { $regex: new RegExp(`^${studentData.lastName}$`, "i") },
        role: "student",
      });

      if (existingUser) {
        // Check if this user is already a student in the same grade/section
        const existingStudent = await Student.findOne({
          userId: existingUser._id,
          grade: studentData.grade,
          section: studentData.section,
        });

        if (existingStudent) {
          throw new AppError(
            httpStatus.CONFLICT,
            `Student with name '${studentData.firstName} ${studentData.lastName}' already exists in Grade ${studentData.grade} Section ${studentData.section}`
          );
        }
      }

      const admissionDate =
        studentData.admissionDate || new Date().toISOString().split("T")[0];
      const admissionYear = new Date(admissionDate).getFullYear();

      // Generate student ID and credentials using CredentialGenerator
      let studentId: string | undefined = undefined;
      let rollNumber: number | undefined = undefined;
      let userCreationAttempts = 0;
      const maxUserCreationAttempts = 3;
      let newUser;

      while (userCreationAttempts < maxUserCreationAttempts) {
        try {
          userCreationAttempts++;

          // Generate fresh credentials for each attempt
          const registration =
            await CredentialGenerator.generateStudentRegistration(
              admissionYear,
              studentData.grade.toString(),
              studentData.schoolId
            );

          studentId = registration.studentId;
          rollNumber = registration.rollNumber;
          credentials = registration.credentials;

          // Create user account for student
          newUser = await User.create(
            [
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
            ],
            { session }
          );

          break; // Success, exit retry loop
        } catch (error: any) {
          if (
            error.code === 11000 &&
            userCreationAttempts < maxUserCreationAttempts
          ) {
            // Duplicate key error, retry with new credentials
            await new Promise((resolve) =>
              setTimeout(resolve, Math.random() * 200 + 100)
            );
            continue;
          } else {
            // Re-throw if not a duplicate key error or if we've exhausted retries
            throw error;
          }
        }
      }

      if (!newUser) {
        throw new AppError(
          httpStatus.INTERNAL_SERVER_ERROR,
          `Failed to create student user after ${maxUserCreationAttempts} attempts. Please try again.`
        );
      }

      if (!studentId || !credentials || rollNumber === undefined) {
        throw new AppError(
          httpStatus.INTERNAL_SERVER_ERROR,
          "Failed to generate student credentials. Please try again."
        );
      }

      // Create student record
      const newStudent = await Student.create(
        [
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
        ],
        { session }
      );

      // Initialize parent user collection
      parentUserDocs = [];

      // Create parent if parent info is provided
      if (studentData.parentInfo) {
        const { parentInfo } = studentData;

        // First check if a parent with similar details already exists to avoid duplicates
        let existingParent: any = null;
        if (parentInfo.email) {
          const existingUser = await User.findOne({
            email: parentInfo.email,
            role: "parent",
            schoolId: studentData.schoolId,
          }).session(session);

          if (existingUser) {
            existingParent = await Parent.findOne({
              userId: existingUser._id,
              schoolId: studentData.schoolId,
            }).session(session);
          }
        }

        if (existingParent) {
          existingParentDoc = existingParent;
          parentWasExisting = true;
          // Use existing parent and add this student to their children
          if (!existingParent.children.includes(newStudent[0]._id)) {
            existingParent.children.push(newStudent[0]._id);
            await existingParent.save({ session });
          }

          // Update student with existing parent reference
          newStudent[0].parentId = existingParent._id;
          await newStudent[0].save({ session });

          // Set parentUser to existing parent's user for credential creation
          const existingParentUser = await User.findById(
            existingParent.userId
          ).session(session);
          if (existingParentUser) {
            parentUserDocs = [existingParentUser];
          }
        } else {
          parentWasExisting = false;
          // Ensure credentials are available
          if (!credentials) {
            throw new AppError(
              httpStatus.INTERNAL_SERVER_ERROR,
              "Failed to generate credentials"
            );
          }

          // Create new parent user account with generated credentials
          parentUserDocs = await User.create(
            [
              {
                schoolId: studentData.schoolId,
                role: "parent",
                username: credentials.parent.username,
                passwordHash: credentials.parent.hashedPassword,
                displayPassword: credentials.parent.password,
                firstName: parentInfo.name.split(" ")[0] || parentInfo.name,
                lastName:
                  parentInfo.name.split(" ").slice(1).join(" ") || "Guardian", // Default lastName if not provided
                phone: parentInfo.phone,
                email: parentInfo.email, // Make sure to save the email
              },
            ],
              { session }
            );

          // Generate parent ID for the Parent model - with retry logic for duplicates
          let parentId: string = "";
          let attempts = 0;
          const maxAttempts = 5;

          do {
            try {
              parentId = await Parent.generateNextParentId(
                studentData.schoolId,
                undefined, // use current year
                session // pass the session for transaction consistency
              );

              // Verify this ID is not already taken
              const existingParentCheck = await Parent.findOne({
                parentId,
              }).session(session);
              if (!existingParentCheck) {
                break; // We found a unique ID
              }

              attempts++;
              if (attempts >= maxAttempts) {
                // Use timestamp-based fallback for absolute uniqueness
                parentId = `PAR-${new Date().getFullYear()}-${Date.now()
                  .toString()
                  .slice(-6)}`;
                break;
              }

              // Add small delay to reduce race conditions
              await new Promise((resolve) => setTimeout(resolve, 10));
            } catch (error) {
              attempts++;
              if (attempts >= maxAttempts) {
                throw new AppError(
                  httpStatus.INTERNAL_SERVER_ERROR,
                  "Failed to generate unique parent ID after multiple attempts"
                );
              }
            }
          } while (attempts < maxAttempts);

          // Create basic parent record with required fields
          let newParent;
          try {
            newParent = await Parent.create(
              [
                {
                  userId: parentUserDocs[0]._id,
                  schoolId: studentData.schoolId,
                  parentId: parentId,
                  children: [newStudent[0]._id], // Link to the student
                  relationship: parentInfo.relationship || "Guardian", // Use provided relationship or default
                  address: {
                    street: parentInfo.address || "",
                    city: "", // Optional field now
                    state: "", // Optional field now
                    zipCode: "", // Optional field now
                    country: "", // Optional field now
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
              ],
              { session }
            );
          } catch (parentError: any) {
            // If we get a duplicate key error even after our checks, try one more time with timestamp
            if (
              parentError.code === 11000 &&
              parentError.keyPattern?.parentId
            ) {
              console.warn(
                "Duplicate parent ID detected, retrying with timestamp-based ID"
              );
              parentId = `PAR-${new Date().getFullYear()}-${Date.now()
                .toString()
                .slice(-6)}`;

              newParent = await Parent.create(
                [
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
                ],
                { session }
              );
            } else {
              throw parentError;
            }
          }

          // Update student with parent reference
          newStudent[0].parentId = newParent[0]._id;
          await newStudent[0].save({ session });
          createdParentDoc = newParent[0];
        }
      }

      // Store credentials in database if adminUserId is provided
      if (adminUserId) {
        if (!credentials) {
          throw new AppError(
            httpStatus.INTERNAL_SERVER_ERROR,
            "Credentials are required for storage"
          );
        }

        const credentialsToStore: any[] = [
          {
            userId: newUser[0]._id,
            schoolId: studentData.schoolId,
            initialUsername: credentials.student.username,
            initialPassword: credentials.student.password, // Store plain password for initial access
            hasChangedPassword: false,
            role: "student",
            issuedBy: new Types.ObjectId(adminUserId),
          },
        ];

        // Handle parent credentials - check if credentials already exist for this parent
        if (parentUserDocs && parentUserDocs.length > 0) {
          // Check if parent credentials already exist for this specific student
          const existingParentCredentialsForStudent =
            await UserCredentials.findOne({
              userId: parentUserDocs[0]._id,
              role: "parent",
              associatedStudentId: newStudent[0]._id,
            }).session(session);

          if (!existingParentCredentialsForStudent) {
            // Check if parent credentials exist for other students (to reuse credentials)
            const existingParentCredentials = await UserCredentials.findOne({
              userId: parentUserDocs[0]._id,
              role: "parent",
            }).session(session);

            if (existingParentCredentials) {
              // Parent credentials exist for other children - create a new entry linking this student to existing credentials
              credentialsToStore.push({
                userId: parentUserDocs[0]._id,
                schoolId: studentData.schoolId,
                initialUsername: existingParentCredentials.initialUsername,
                initialPassword: existingParentCredentials.initialPassword,
                hasChangedPassword:
                  existingParentCredentials.hasChangedPassword,
                role: "parent",
                associatedStudentId: newStudent[0]._id,
                issuedBy: new Types.ObjectId(adminUserId),
              });
            } else {
              // New parent - create new credentials
              credentialsToStore.push({
                userId: parentUserDocs[0]._id,
                schoolId: studentData.schoolId,
                initialUsername: credentials.parent.username,
                initialPassword: credentials.parent.password,
                hasChangedPassword: false,
                role: "parent",
                associatedStudentId: newStudent[0]._id,
                issuedBy: new Types.ObjectId(adminUserId),
              });
            }
          }
          // If credentials already exist for this specific student, don't add anything to avoid duplicates
        }

        const storedCredentials = await UserCredentials.insertMany(
          credentialsToStore,
          { session }
        );
        storedCredentialIds = storedCredentials.map((doc) => doc._id);
      }

      // Commit transaction
      await session.commitTransaction();

      // Populate and return (after transaction is committed)
      await newStudent[0].populate([
        { path: "userId", select: "firstName lastName username email phone" },
        { path: "schoolId", select: "name" },
        { path: "parentId" },
      ]);
      studentDoc = newStudent[0];
      studentUserDoc = newUser[0];

      if (!schoolDoc) {
        throw new AppError(
          httpStatus.INTERNAL_SERVER_ERROR,
          "School context unavailable during photo upload"
        );
      }

      const cloudinaryFolderPath = generateCloudinaryFolderPath(
        schoolDoc.name,
        "student",
        studentData.firstName,
        new Date(studentData.dob),
        studentData.bloodGroup,
        new Date(studentData.admissionDate || Date.now()),
        studentData.grade,
        studentData.section,
        studentId!
      );

      const cloudinaryResults = await uploadPhotosToCloudinary(
        photos,
        cloudinaryFolderPath,
        studentId!
      );

      uploadedPublicIds.push(
        ...cloudinaryResults.map((result) => result.public_id)
      );

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

      const uploadedPhotos = await StudentPhoto.insertMany(photoDocuments);

      const age =
        new Date().getFullYear() - new Date(studentData.dob).getFullYear();
      const admitDate = new Date(studentData.admissionDate || Date.now())
        .toISOString()
        .split("T")[0];

      try {
        await FileUtils.createStudentPhotoFolder(schoolDoc.name, {
          firstName: studentData.firstName,
          age,
          grade: studentData.grade,
          section: studentData.section as string,
          bloodGroup: studentData.bloodGroup,
          admitDate,
          studentId: studentId!,
        });
      } catch (error) {
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
          createdAt: photo.createdAt as Date,
        }));
        response.photoCount = uploadedPhotos.length;
      }

      if (credentials) {
        let parentCredentials = {
          username: credentials.parent.username,
          password: credentials.parent.password,
        };

        if (parentUserDocs && parentUserDocs.length > 0) {
          const existingParentCredentials = await UserCredentials.findOne({
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
    } catch (error: unknown) {
      // Only abort if transaction is still active
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      // If we already created core records and failed later, perform cleanup
      if (studentDoc) {
        // Attempt to remove any photo documents and cloud assets
        try {
          await StudentPhoto.deleteMany({ studentId: studentDoc._id });
        } catch (cleanupError) {
          console.error("Failed to remove student photos after error:", cleanupError);
        }

        if (uploadedPublicIds.length > 0) {
          try {
            await Promise.all(
              uploadedPublicIds.map((publicId) => deleteFromCloudinary(publicId))
            );
          } catch (cleanupError) {
            console.error("Failed to delete Cloudinary assets after error:", cleanupError);
          }
        }

        try {
          await Student.deleteOne({ _id: studentDoc._id });
        } catch (cleanupError) {
          console.error("Failed to delete student record after photo failure:", cleanupError);
        }

        if (studentUserDoc) {
          try {
            await User.deleteOne({ _id: studentUserDoc._id });
          } catch (cleanupError) {
            console.error("Failed to delete student user after photo failure:", cleanupError);
          }
        }

        if (createdParentDoc) {
          try {
            await Parent.deleteOne({ _id: createdParentDoc._id });
          } catch (cleanupError) {
            console.error("Failed to delete parent record after photo failure:", cleanupError);
          }
        }

        if (!parentWasExisting && parentUserDocs && parentUserDocs.length > 0) {
          try {
            await User.deleteOne({ _id: parentUserDocs[0]._id });
          } catch (cleanupError) {
            console.error("Failed to delete parent user after photo failure:", cleanupError);
          }
        }

        if (parentWasExisting && existingParentDoc) {
          try {
            await Parent.updateOne(
              { _id: existingParentDoc._id },
              { $pull: { children: studentDoc._id } }
            );
          } catch (cleanupError) {
            console.error(
              "Failed to roll back existing parent relationship after photo failure:",
              cleanupError
            );
          }
        }

        if (storedCredentialIds.length > 0) {
          try {
            await UserCredentials.deleteMany({
              _id: { $in: storedCredentialIds },
            });
          } catch (cleanupError) {
            console.error(
              "Failed to remove stored credentials after photo failure:",
              cleanupError
            );
          }
        }
      }

      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to create student: ${(error as Error).message}`
      );
    } finally {
      session.endSession();
    }
  }

  async getStudents(queryParams: {
    page: number;
    limit: number;
    schoolId?: string;
    grade?: number;
    section?: string;
    isActive?: string;
    search?: string;
    sortBy: string;
    sortOrder: string;
  }): Promise<{
    students: IStudentResponse[];
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
        grade,
        section,
        isActive,
        search,
        sortBy,
        sortOrder,
      } = queryParams;
      const skip = (page - 1) * limit;

      // Build query
      const query: any = {};

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

      // Handle student ID search separately
      if (search && !userQuery.$or) {
        query.$or = [{ studentId: { $regex: new RegExp(search, "i") } }];
      }

      // Build sort
      const sort: any = {};
      if (sortBy === "firstName" || sortBy === "lastName") {
        // For user fields, we'll sort after population
        sort.grade = 1;
        sort.section = 1;
        sort.rollNumber = 1;
      } else {
        sort[sortBy] = sortOrder === "desc" ? -1 : 1;
      }

      // Execute queries
      const [students, totalCount] = await Promise.all([
        Student.find(query)
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
        Student.countDocuments(query),
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      return {
        students: students.map((student) =>
          this.formatStudentResponse(student)
        ),
        totalCount,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      };
    } catch (error) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to fetch students: ${(error as Error).message}`
      );
    }
  }

  async getStudentById(id: string): Promise<IStudentResponse> {
    try {
      if (!Types.ObjectId.isValid(id)) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid student ID format");
      }

      const student = await Student.findById(id)
        .populate("userId", "firstName lastName username email phone")
        .populate(
          "schoolId",
          "_id name schoolId establishedYear address contact affiliation logo"
        )
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
        throw new AppError(httpStatus.NOT_FOUND, "Student not found");
      }

      return this.formatStudentResponse(student);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to fetch student: ${(error as Error).message}`
      );
    }
  }

  async updateStudent(
    id: string,
    updateData: IUpdateStudentRequest
  ): Promise<IStudentResponse> {
    const session = await mongoose.startSession();

    try {
      if (!Types.ObjectId.isValid(id)) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid student ID format");
      }

      session.startTransaction();

      const student = await Student.findById(id).session(session);
      if (!student) {
        throw new AppError(httpStatus.NOT_FOUND, "Student not found");
      }

      // Update student record
      const studentUpdateData: any = {};
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

      // Update student if there are any changes
      if (Object.keys(studentUpdateData).length > 0) {
        await Student.findByIdAndUpdate(
          id,
          { $set: studentUpdateData },
          { new: true, runValidators: true, session }
        );
      }

      // Update parent information if provided
      if (updateData.parentInfo && student.parentId) {
        const parentUpdateData: any = {};

        // Update parent record
        if (updateData.parentInfo.name) {
          // Split parent name into first and last name
          const nameParts = updateData.parentInfo.name.trim().split(/\s+/);
          const firstName = nameParts[0] || "";
          const lastName = nameParts.slice(1).join(" ") || "";

          // Update parent user information
          await User.findOneAndUpdate(
            {
              _id: {
                $in: await Parent.findById(student.parentId).then(
                  (p) => p?.userId
                ),
              },
            },
            {
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
            },
            { session }
          );
        }

        // Update parent-specific information
        if (updateData.parentInfo.address || updateData.parentInfo.occupation) {
          await Parent.findByIdAndUpdate(
            student.parentId,
            {
              $set: {
                ...(updateData.parentInfo.address && {
                  address: updateData.parentInfo.address,
                }),
                ...(updateData.parentInfo.occupation && {
                  occupation: updateData.parentInfo.occupation,
                }),
              },
            },
            { session }
          );
        }
      }

      await session.commitTransaction();

      // Fetch the updated student with populated fields
      const updatedStudent = await Student.findById(id)
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
        throw new AppError(httpStatus.NOT_FOUND, "Updated student not found");
      }

      return this.formatStudentResponse(updatedStudent);
    } catch (error) {
      await session.abortTransaction();
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to update student: ${(error as Error).message}`
      );
    } finally {
      session.endSession();
    }
  }

  async deleteStudent(id: string): Promise<void> {
    try {
      if (!Types.ObjectId.isValid(id)) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid student ID format");
      }

      const student = await Student.findById(id)
        .populate("userId", "firstName lastName")
        .populate("schoolId", "_id name");

      if (!student) {
        throw new AppError(httpStatus.NOT_FOUND, "Student not found");
      }

      // Delete associated user account
      if (student.userId) {
        await User.findByIdAndDelete(student.userId);
      }

      // Delete photo folder
      try {
        const age =
          new Date().getFullYear() - new Date(student.dob).getFullYear();
        const admitDate = student.admissionDate.toISOString().split("T")[0];

        const folderPath = await FileUtils.createStudentPhotoFolder(
          (student.schoolId as any).name,
          {
            firstName: (student.userId as any).firstName,
            age,
            grade: student.grade,
            section: student.section,
            bloodGroup: student.bloodGroup,
            admitDate,
            studentId: student.studentId,
          }
        );

        await FileUtils.deleteFolder(folderPath);
      } catch (error) {
        console.warn("Failed to delete photo folder:", error);
      }

      // The pre-delete middleware in the model will handle photo deletion
      await student.deleteOne();
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to delete student: ${(error as Error).message}`
      );
    }
  }

  async uploadPhotos(
    studentId: string,
    files: Express.Multer.File[]
  ): Promise<IStudentPhotoResponse[]> {
    try {
      if (!Types.ObjectId.isValid(studentId)) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid student ID format");
      }

      const student = await Student.findById(studentId)
        .populate("userId", "firstName lastName")
        .populate("schoolId", "_id name");

      if (!student) {
        throw new AppError(httpStatus.NOT_FOUND, "Student not found");
      }

      // Check current photo count
      const currentPhotoCount = await StudentPhoto.countDocuments({
        studentId,
      });
      const remainingSlots = config.max_photos_per_student - currentPhotoCount;

      if (files.length > remainingSlots) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Can only upload ${remainingSlots} more photos. Maximum ${config.max_photos_per_student} photos allowed per student.`
        );
      }

      // Validate all files first
      for (const file of files) {
        const validation = FileUtils.validateImageFile(file);
        if (!validation.isValid) {
          throw new AppError(httpStatus.BAD_REQUEST, validation.error!);
        }
      }

      // Generate Cloudinary folder path for student photos
      const cloudinaryFolderPath = generateCloudinaryFolderPath(
        (student.schoolId as any).name,
        "student",
        (student.userId as any).firstName,
        new Date(student.dob),
        student.bloodGroup,
        new Date(student.admissionDate),
        student.grade,
        student.section,
        student.studentId
      );

      // Upload photos to Cloudinary
      const cloudinaryResults = await uploadPhotosToCloudinary(
        files,
        cloudinaryFolderPath,
        student.studentId
      );

      // Create photo records with Cloudinary data
      const uploadedPhotos: IStudentPhotoResponse[] = [];

      for (const result of cloudinaryResults) {
        const photoRecord = await StudentPhoto.create({
          studentId,
          schoolId: student.schoolId,
          photoPath: result.secure_url, // Cloudinary URL
          photoNumber: result.photoNumber,
          filename: result.public_id, // Cloudinary public_id
          originalName: result.originalName,
          mimetype: "image/jpeg", // Cloudinary converts to JPEG
          size: result.size || 0,
        });

        uploadedPhotos.push({
          id: photoRecord._id.toString(),
          photoPath: photoRecord.photoPath,
          photoNumber: photoRecord.photoNumber,
          filename: photoRecord.filename,
          size: photoRecord.size,
          createdAt: photoRecord.createdAt as Date,
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

  async deletePhoto(studentId: string, photoId: string): Promise<void> {
    try {
      if (
        !Types.ObjectId.isValid(studentId) ||
        !Types.ObjectId.isValid(photoId)
      ) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid ID format");
      }

      const photo = await StudentPhoto.findOne({ _id: photoId, studentId });
      if (!photo) {
        throw new AppError(httpStatus.NOT_FOUND, "Photo not found");
      }

      // Delete from Cloudinary using the public_id (filename field stores Cloudinary public_id)
      await deleteFromCloudinary(photo.filename);

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

  async getStudentsByGradeAndSection(
    schoolId: string,
    grade: number,
    section: string
  ): Promise<IStudentResponse[]> {
    try {
      if (!Types.ObjectId.isValid(schoolId)) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid school ID format");
      }

      const students = await Student.findByGradeAndSection(
        schoolId,
        grade,
        section
      );
      return students.map((student) => this.formatStudentResponse(student));
    } catch (error) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to fetch students by grade and section: ${
          (error as Error).message
        }`
      );
    }
  }

  async getStudentStats(schoolId: string): Promise<IStudentStats> {
    try {
      if (!Types.ObjectId.isValid(schoolId)) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid school ID format");
      }

      const [
        totalStudents,
        activeStudents,
        gradeStats,
        sectionStats,
        recentAdmissions,
      ] = await Promise.all([
        Student.countDocuments({ schoolId }),
        Student.countDocuments({ schoolId, isActive: true }),
        Student.aggregate([
          { $match: { schoolId: new Types.ObjectId(schoolId) } },
          { $group: { _id: "$grade", count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ]),
        Student.aggregate([
          { $match: { schoolId: new Types.ObjectId(schoolId) } },
          { $group: { _id: "$section", count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ]),
        Student.countDocuments({
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
    } catch (error) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to fetch student stats: ${(error as Error).message}`
      );
    }
  }

  async getStudentPhotos(studentId: string): Promise<IStudentPhotoResponse[]> {
    try {
      if (!Types.ObjectId.isValid(studentId)) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid student ID format");
      }

      const photos = await StudentPhoto.find({ studentId })
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
        `Failed to fetch student photos: ${(error as Error).message}`
      );
    }
  }

  async getStudentCredentials(studentId: string): Promise<{
    student: {
      id: string;
      username: string;
      password: string;
      email?: string;
      phone?: string;
    };
    parent: {
      id: string;
      username: string;
      password: string;
      email?: string;
      phone?: string;
    };
  } | null> {
    try {
      if (!Types.ObjectId.isValid(studentId)) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid student ID format");
      }

      // Get student with populated data
      const student = await Student.findById(studentId)
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
        throw new AppError(httpStatus.NOT_FOUND, "Student not found");
      }

      // Get stored credentials for student and parent
      const [studentCredentials, parentCredentials] = await Promise.all([
        UserCredentials.findOne({
          userId: student.userId,
          role: "student",
        }).lean(),
        // Query parent credentials by associatedStudentId instead of userId
        UserCredentials.findOne({
          associatedStudentId: student._id,
          role: "parent",
        }).lean(),
      ]);

      if (!studentCredentials) {
        return null; // No credentials found
      }

      const result = {
        student: {
          id: student.studentId,
          username: studentCredentials.initialUsername,
          password: studentCredentials.initialPassword,
          email: (student.userId as any).email,
          phone: (student.userId as any).phone,
        },
        parent: {
          id: student.parentId
            ? (student.parentId as any).parentId || "N/A"
            : "N/A",
          username: parentCredentials?.initialUsername || "N/A",
          password: parentCredentials?.initialPassword || "N/A",
          email: student.parentId
            ? (student.parentId as any).userId?.email
            : undefined,
          phone: student.parentId
            ? (student.parentId as any).userId?.phone
            : undefined,
        },
      };

      return result;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to retrieve student credentials: ${(error as Error).message}`
      );
    }
  }

  async getAvailablePhotoSlots(studentId: string): Promise<number[]> {
    try {
      if (!Types.ObjectId.isValid(studentId)) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid student ID format");
      }

      const student = await Student.findById(studentId)
        .populate("userId", "firstName")
        .populate("schoolId", "_id name");

      if (!student) {
        throw new AppError(httpStatus.NOT_FOUND, "Student not found");
      }

      // Get student folder path
      const age =
        new Date().getFullYear() - new Date(student.dob).getFullYear();
      const admitDate = student.admissionDate.toISOString().split("T")[0];

      const folderPath = await FileUtils.createStudentPhotoFolder(
        (student.schoolId as any).name,
        {
          firstName: (student.userId as any).firstName,
          age,
          grade: student.grade,
          section: student.section,
          bloodGroup: student.bloodGroup,
          admitDate,
          studentId: student.studentId,
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

  private formatStudentResponse(student: any): IStudentResponse {
    const age = student.dob
      ? new Date().getFullYear() - new Date(student.dob).getFullYear()
      : 0;
    const admissionYear = student.admissionDate
      ? new Date(student.admissionDate).getFullYear()
      : new Date().getFullYear();

    // Helper function to safely extract ID
    const extractId = (obj: any): string => {
      if (!obj) return "";
      if (typeof obj === "string") return obj;
      if (obj._id) return obj._id.toString();
      if (obj.id) return obj.id.toString();
      return obj.toString();
    };

    // Handle user data - check both userId and user properties (similar to teacher fix)
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
            fullName:
              `${userData.firstName || ""} ${userData.lastName || ""}`.trim() ||
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
            fullName: (student.parentId as any).userId
              ? `${(student.parentId as any).userId.firstName || ""} ${
                  (student.parentId as any).userId.lastName || ""
                }`.trim()
              : "Unknown Parent",
            name: (student.parentId as any).userId
              ? `${(student.parentId as any).userId.firstName || ""} ${
                  (student.parentId as any).userId.lastName || ""
                }`.trim()
              : "Unknown Parent",
            email: (student.parentId as any).userId?.email || undefined,
            phone: (student.parentId as any).userId?.phone || undefined,
            address: student.parentId.address
              ? `${student.parentId.address.street || ""} ${
                  student.parentId.address.city || ""
                } ${student.parentId.address.state || ""} ${
                  student.parentId.address.country || ""
                }`.trim()
              : undefined,
            occupation: student.parentId.occupation || undefined,
            relationship: student.parentId.relationship || undefined,
          }
        : undefined,
      photos:
        student.photos?.map((photo: any) => ({
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

  async getStudentDashboard(studentId: string) {
    // Get student details
    const student = await Student.findOne({ userId: studentId })
      .populate("schoolId", "name")
      .populate("userId", "firstName lastName fullName email phone")
      .populate(
        "parentId",
        "fullName email phone address occupation relationship"
      );

    if (!student) {
      throw new AppError(httpStatus.NOT_FOUND, "Student not found");
    }

    // Get attendance percentage for current month
    const currentMonth = new Date();
    currentMonth.setDate(1);
    const nextMonth = new Date(currentMonth);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    const attendanceRecords = await Attendance.aggregate([
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
    const presentDays = attendanceRecords.filter(
      (record) => record.students.status === "present"
    ).length;
    const attendancePercentage =
      totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;

    // Get pending homework count
    const pendingHomework = await Homework.countDocuments({
      "assignments.studentId": student._id,
      "assignments.status": { $in: ["pending", "overdue"] },
    });

    const assessmentOverview = await assessmentService.getStudentOverview(
      student._id
    );

    const overallPercentage =
      assessmentOverview.overall?.averagePercentage || 0;
    const overallGrade = this.deriveGradeLetter(overallPercentage);

    // Get today's classes count
    const today = new Date();
    const dayOfWeek = today
      .toLocaleString("en-US", { weekday: "long" })
      .toLowerCase();

    const todayClasses = await Schedule.countDocuments({
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

    // Get upcoming assignments
    const upcomingAssignments = await Homework.aggregate([
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

    const upcomingEvents = await AcademicCalendar.countDocuments({
      startDate: { $gte: today },
      isActive: true,
    });

    const upcomingAssessments = await Assessment.find({
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
        fullName: (student as any).userId?.fullName || "",
        email: (student as any).userId?.email || "",
        phone: (student as any).userId?.phone || "",
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
        subjectName: (assessment.subjectId as any)?.name,
        subjectCode: (assessment.subjectId as any)?.code,
      })),
    };
  }

  async getStudentAttendance(studentId: string) {
    const student = await Student.findOne({ userId: studentId });
    if (!student) {
      throw new AppError(httpStatus.NOT_FOUND, "Student not found");
    }

    // Get attendance records for current academic year
    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(currentYear, 0, 1);
    const endOfYear = new Date(currentYear + 1, 0, 1);

    // ✅ FIX: Query StudentDayAttendance instead of Attendance
    const attendanceRecords = await StudentDayAttendance.find({
      schoolId: student.schoolId,
      studentId: student._id,
      date: { $gte: startOfYear, $lte: endOfYear },
    })
      .sort({ date: -1 })
      .lean();

    // Calculate statistics
    const totalDays = attendanceRecords.length;
    const presentDays = attendanceRecords.filter(r =>
      ['present', 'late'].includes(r.finalStatus)
    ).length;
    const absentDays = attendanceRecords.filter(r => r.finalStatus === 'absent').length;
    const lateDays = attendanceRecords.filter(r => r.finalStatus === 'late').length;

    // Calculate monthly statistics
    const monthlyMap = new Map<string, any>();
    attendanceRecords.forEach(record => {
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
      if (record.finalStatus === 'present') stats.presentDays++;
      if (record.finalStatus === 'absent') stats.absentDays++;
      if (record.finalStatus === 'late') stats.lateDays++;
    });

    const monthlyStats = Array.from(monthlyMap.values()).map(m => ({
      ...m,
      percentage: m.totalDays > 0
        ? Math.round((m.presentDays / m.totalDays) * 100)
        : 0,
    }));

    // Format recent records - REMOVE subject/period, ADD auto-detect info
    const recentRecords = attendanceRecords.slice(0, 10).map(record => ({
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
        attendancePercentage: totalDays > 0
          ? Math.round((presentDays / totalDays) * 100)
          : 0,
      },
      monthlyStats,
      recentRecords,
    };
  }

  async getStudentGrades(studentId: string) {
    const student = await Student.findOne({ userId: studentId });
    if (!student) {
      throw new AppError(httpStatus.NOT_FOUND, "Student not found");
    }

    return assessmentService.getStudentOverview(student._id);
  }

  async getStudentHomework(studentId: string) {
    const student = await Student.findOne({ userId: studentId });
    if (!student) {
      throw new AppError(httpStatus.NOT_FOUND, "Student not found");
    }

    // Get homework assignments for the student's grade and section
    const homework = await Homework.aggregate([
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

    // Calculate statistics
    const totalHomework = homework.length;
    const completedHomework = homework.filter(
      (h) => h.status === "submitted" || h.status === "graded"
    ).length;
    const pendingHomework = homework.filter(
      (h) => h.status === "pending"
    ).length;
    const overdueHomework = homework.filter((h) => {
      return h.status === "overdue";
    }).length;

    return {
      summary: {
        totalHomework,
        completedHomework,
        pendingHomework,
        overdueHomework,
        completionRate:
          totalHomework > 0
            ? Math.round((completedHomework / totalHomework) * 100)
            : 0,
      },
      homework: homework,
    };
  }

  async getStudentSchedule(studentId: string) {
    const student = await Student.findOne({ userId: studentId });
    if (!student) {
      throw new AppError(httpStatus.NOT_FOUND, "Student not found");
    }

    // Get schedule for the student's grade and section
    const schedule = await Schedule.aggregate([
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

    // Group by day of week
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

  async getStudentCalendar(studentId: string) {
    const student = await Student.findOne({ userId: studentId });
    if (!student) {
      throw new AppError(httpStatus.NOT_FOUND, "Student not found");
    }

    // Use the new event service instead of AcademicCalendar
    const { eventService } = await import("../event/event.service");

    // Get all events for the student
    const eventsResult = await eventService.getEvents(
      student.schoolId,
      "student",
      student.grade,
      student.section,
      { limit: 100, isActive: true }
    );

    // Get today's events
    const todaysEvents = await eventService.getTodaysEvents(
      student.schoolId,
      "student",
      student.grade,
      student.section
    );

    // Convert events to calendar format
    const calendarEvents = eventsResult.events.map((event: any) => ({
      title: event.title,
      description: event.description,
      eventType: event.type,
      startDate: event.date,
      endDate: event.date,
      color: this.getEventColor(event.type),
      targetAudience: event.targetAudience,
    }));

    const upcomingAssessmentsForCalendar = await Assessment.find({
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

    // Get upcoming homework deadlines
    const upcomingHomework = await Homework.aggregate([
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

    // Combine all events
    const upcomingAssessmentEvents = upcomingAssessmentsForCalendar.map(
      (assessment: any) => ({
        title: `${assessment.examName} - ${assessment.subjectId?.name ?? ""}`,
        description: `Exam: ${assessment.examName}`,
        eventType: "exam",
        startDate: assessment.examDate,
        endDate: assessment.examDate,
        color: "#ef4444",
        subject: assessment.subjectId?.name ?? "",
      })
    );

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

  async getStudentDisciplinaryActions(userId: string) {
    try {
      // Find the student by userId
      const student = await Student.findOne({ userId });
      if (!student) {
        throw new AppError(httpStatus.NOT_FOUND, "Student not found");
      }

      const { DisciplinaryAction } = await import(
        "../disciplinary/disciplinary.model"
      );

      // Get only red warrants for this student (students/parents can only see red warrants)
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

      // Get stats for this student (only red warrants)
      const stats = await DisciplinaryAction.getDisciplinaryStats(
        student.schoolId.toString(),
        {
          studentId: student._id,
          isRedWarrant: true,
        }
      );

      const formattedActions = actions.map((action: any) => {
        const teacher = action.teacherId as any;
        const teacherUser = teacher?.userId as any;

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
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to get student disciplinary actions: ${
          (error as Error).message
        }`
      );
    }
  }
}

export const studentService = new StudentService();
