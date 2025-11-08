import { FilterQuery, Types } from "mongoose";
import httpStatus from "http-status";
import config from "../../config";
import { AppError } from "../../errors/AppError";
import { Conversation, Message } from "./messaging.model";
import {
  ConversationSummary,
  MessageSummary,
  MessagingContact,
  MessagingContactStudent,
  MessagingContextType,
} from "./messaging.interface";
import { User } from "../user/user.model";
import { IUserDocument, UserRole } from "../user/user.interface";
import { Teacher } from "../teacher/teacher.model";
import { ITeacherDocument } from "../teacher/teacher.interface";
import { Student } from "../student/student.model";
import { IStudentDocument } from "../student/student.interface";
import { Parent } from "../parent/parent.model";
import { IParentDocument } from "../parent/parent.interface";
import { Schedule } from "../schedule/schedule.model";

type AuthUser = {
  id: string;
  role: UserRole | string;
  schoolId?: string;
};

interface CreateConversationPayload {
  participantIds: string[];
  contextStudentId?: string;
}

interface ListMessagesQuery {
  cursor?: Date;
  limit?: number;
}

const MAX_CONTACTS = 1000;

const sanitizePreview = (body: string): string =>
  body.length <= 180 ? body : `${body.slice(0, 177)}...`;

const normalizeObjectId = (value: string | Types.ObjectId): Types.ObjectId => {
  if (value instanceof Types.ObjectId) {
    return value;
  }
  if (typeof value === "string" && Types.ObjectId.isValid(value)) {
    return new Types.ObjectId(value);
  }
  throw new AppError(httpStatus.BAD_REQUEST, "Invalid identifier");
};

const isPopulatedUser = (value: unknown): value is IUserDocument =>
  !!value && typeof value === "object" && "role" in (value as any);

const isPopulatedStudent = (value: unknown): value is IStudentDocument =>
  !!value && typeof value === "object" && "grade" in (value as any);

class MessagingService {
  private ensureEnabled() {
    if (!config.messaging_enabled) {
      throw new AppError(
        httpStatus.SERVICE_UNAVAILABLE,
        "Messaging is disabled for this environment"
      );
    }
  }

  private async getAuthUserDocument(user: AuthUser): Promise<IUserDocument> {
    const userDoc = await User.findById(user.id);
    if (!userDoc) {
      throw new AppError(httpStatus.UNAUTHORIZED, "User context missing");
    }
    if (!userDoc.schoolId) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "User is not associated with a school"
      );
    }
    return userDoc;
  }

  private async getTeacherByUserId(
    schoolId: Types.ObjectId,
    userId: Types.ObjectId
  ): Promise<ITeacherDocument> {
    const teacher = await Teacher.findOne({
      schoolId,
      userId,
    });
    if (!teacher) {
      throw new AppError(httpStatus.FORBIDDEN, "Teacher profile not found");
    }
    return teacher;
  }

  private async getStudentById(
    schoolId: Types.ObjectId,
    studentId: Types.ObjectId
  ): Promise<IStudentDocument> {
    const student = await Student.findOne({
      _id: studentId,
      schoolId,
      isActive: true,
    })
      .populate("userId", "firstName lastName role username")
      .populate({
        path: "parentId",
        select: "userId children",
      });
    if (!student) {
      throw new AppError(httpStatus.NOT_FOUND, "Student not found");
    }
    return student;
  }

  private async getParentByUserId(
    schoolId: Types.ObjectId,
    userId: Types.ObjectId
  ): Promise<IParentDocument> {
    const parent = await Parent.findOne({
      schoolId,
      userId,
      isActive: true,
    }).populate({
      path: "children",
      match: { isActive: true },
      populate: {
        path: "userId",
        select: "firstName lastName role",
      },
    });
    if (!parent) {
      throw new AppError(httpStatus.FORBIDDEN, "Parent profile not found");
    }
    return parent;
  }

  private async loadUserSummaries(
    userIds: Types.ObjectId[]
  ): Promise<Map<string, { fullName: string; role: UserRole }>> {
    if (!userIds.length) {
      return new Map();
    }
    const users = await User.find({
      _id: { $in: userIds },
    })
      .select("firstName lastName role")
      .lean();

    const map = new Map<string, { fullName: string; role: UserRole }>();
    users.forEach((u) => {
      const fullName = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
      map.set(u._id.toString(), {
        fullName: fullName || u.firstName || "Unnamed",
        role: u.role as UserRole,
      });
    });
    return map;
  }

  private buildParticipantHash(userIds: Types.ObjectId[]): string {
    return userIds
      .map((id) => id.toString())
      .sort()
      .join("|");
  }

  private ensureAllowedRole(role: string): asserts role is UserRole {
    const allowed: UserRole[] = [
      UserRole.TEACHER,
      UserRole.STUDENT,
      UserRole.PARENT,
    ];
    if (!allowed.includes(role as UserRole)) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "Messaging is restricted to teachers, students, and parents"
      );
    }
  }

  private async ensureTeacherCanAccessStudent(
    schoolId: Types.ObjectId,
    teacherUserId: Types.ObjectId,
    student: IStudentDocument
  ): Promise<ITeacherDocument> {
    const teacher = await this.getTeacherByUserId(schoolId, teacherUserId);

    const assignmentExists = await Schedule.exists({
      schoolId,
      isActive: true,
      grade: student.grade,
      section: student.section,
      "periods.teacherId": teacher._id,
    });

    if (!assignmentExists) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "Teacher is not assigned to this student"
      );
    }

    return teacher;
  }

  private formatContact(
    user: IUserDocument,
    role: UserRole,
    relatedStudents: MessagingContactStudent[]
  ): MessagingContact {
    const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
    return {
      userId: user._id.toString(),
      role,
      fullName: fullName || user.username,
      relatedStudents,
    };
  }

  private async getContactsForTeacher(
    authUser: AuthUser,
    userDoc: IUserDocument
  ): Promise<MessagingContact[]> {
    const schoolObjectId = normalizeObjectId(userDoc.schoolId!);
    const teacher = await this.getTeacherByUserId(schoolObjectId, userDoc._id);

    const schedules = await Schedule.find({
      schoolId: schoolObjectId,
      isActive: true,
      "periods.teacherId": teacher._id,
    })
      .select("grade section")
      .lean();

    if (!schedules.length) {
      return [];
    }

    const gradeSections = new Map<string, { grade: number; section: string }>();
    schedules.forEach((schedule) => {
      const key = `${schedule.grade}|${schedule.section}`;
      if (!gradeSections.has(key)) {
        gradeSections.set(key, {
          grade: schedule.grade,
          section: schedule.section,
        });
      }
    });

    const gradeSectionFilters = Array.from(gradeSections.values()).map(
      ({ grade, section }) => ({ grade, section })
    );

    const students = await Student.find({
      schoolId: schoolObjectId,
      isActive: true,
      $or: gradeSectionFilters.slice(0, MAX_CONTACTS),
    })
      .populate({
        path: "userId",
        select: "firstName lastName role username",
      })
      .populate({
        path: "parentId",
        select: "userId children",
        populate: {
          path: "userId",
          select: "firstName lastName role username",
        },
      });

    const contacts: MessagingContact[] = [];
    const parentMap = new Map<string, MessagingContact>();

    students.forEach((studentDoc) => {
      const studentUser = isPopulatedUser(studentDoc.userId)
        ? studentDoc.userId
        : undefined;
      if (!studentUser) {
        return;
      }
      const studentName = `${studentUser.firstName ?? ""} ${
        studentUser.lastName ?? ""
      }`.trim();
      contacts.push({
        userId: studentUser._id.toString(),
        role: UserRole.STUDENT,
        fullName: studentName || studentUser.username,
        relatedStudents: [
          {
            studentId: studentDoc._id.toString(),
            studentName: studentName || "Student",
          },
        ],
      });

      // parentId can be either an ObjectId or a populated Parent document.
      // Cast via 'unknown' first to avoid TypeScript conversion errors when
      // an ObjectId is being asserted to IParentDocument at compile time.
      const parentDoc = studentDoc.parentId as unknown as
        | IParentDocument
        | undefined;
      if (parentDoc?.userId && isPopulatedUser(parentDoc.userId)) {
        const parentUser = parentDoc.userId;
        const parentKey = parentUser._id.toString();
        const entry =
          parentMap.get(parentKey) ??
          this.formatContact(parentUser, UserRole.PARENT, []);
        entry.relatedStudents.push({
          studentId: studentDoc._id.toString(),
          studentName: studentName || "Student",
        });
        parentMap.set(parentKey, entry);
      }
    });

    return [...contacts, ...Array.from(parentMap.values())];
  }

  private async getContactsForStudent(
    userDoc: IUserDocument,
    student: IStudentDocument
  ): Promise<MessagingContact[]> {
    const schoolObjectId = normalizeObjectId(userDoc.schoolId!);

    const schedules = await Schedule.find({
      schoolId: schoolObjectId,
      isActive: true,
      grade: student.grade,
      section: student.section,
    })
      .select("periods.teacherId")
      .lean();

    const teacherIds = new Set<string>();
    schedules.forEach((schedule) => {
      schedule.periods.forEach((period) => {
        if (period.teacherId) {
          teacherIds.add(period.teacherId.toString());
        }
      });
    });

    if (!teacherIds.size) {
      return [];
    }

    const teachers = await Teacher.find({
      _id: { $in: Array.from(teacherIds).slice(0, MAX_CONTACTS) },
    }).populate({
      path: "userId",
      select: "firstName lastName role username",
    });

    return teachers
      .map((teacherDoc) => {
        const teacherUser = isPopulatedUser(teacherDoc.userId)
          ? teacherDoc.userId
          : undefined;
        if (!teacherUser) {
          return undefined;
        }
        const fullName = `${teacherUser.firstName ?? ""} ${
          teacherUser.lastName ?? ""
        }`.trim();
        return {
          userId: teacherUser._id.toString(),
          role: UserRole.TEACHER,
          fullName: fullName || teacherUser.username,
          relatedStudents: [
            {
              studentId: student._id.toString(),
              studentName:
                `${(student.userId as any)?.firstName ?? ""} ${
                  (student.userId as any)?.lastName ?? ""
                }`.trim() || "Student",
            },
          ],
        } as MessagingContact;
      })
      .filter(Boolean) as MessagingContact[];
  }

  private async getContactsForParent(
    userDoc: IUserDocument,
    parent: IParentDocument
  ): Promise<MessagingContact[]> {
    const schoolObjectId = normalizeObjectId(userDoc.schoolId!);

    const childEntries =
      (parent.children as Array<IStudentDocument | Types.ObjectId>) ?? [];
    if (!childEntries.length) {
      return [];
    }

    const teacherMap = new Map<string, MessagingContact>();

    for (const childRef of childEntries) {
      let populatedChild: IStudentDocument | null = null;

      if (isPopulatedStudent(childRef)) {
        populatedChild = childRef;
      } else if (childRef instanceof Types.ObjectId) {
        populatedChild = await Student.findById(childRef).populate({
          path: "userId",
          select: "firstName lastName role username",
        });
      }

      if (!populatedChild) {
        continue;
      }

      const contactLabel =
        `${(populatedChild.userId as any)?.firstName ?? ""} ${
          (populatedChild.userId as any)?.lastName ?? ""
        }`.trim() || "Student";

      const teacherContacts = await this.getContactsForStudent(
        userDoc,
        populatedChild
      );

      teacherContacts.forEach((teacherContact) => {
        const existing = teacherMap.get(teacherContact.userId);
        if (existing) {
          if (
            !existing.relatedStudents.some(
              (rs) => rs.studentId === populatedChild._id.toString()
            )
          ) {
            existing.relatedStudents.push({
              studentId: populatedChild._id.toString(),
              studentName: contactLabel,
            });
          }
        } else {
          teacherMap.set(teacherContact.userId, {
            ...teacherContact,
            relatedStudents: [
              {
                studentId: populatedChild._id.toString(),
                studentName: contactLabel,
              },
            ],
          });
        }
      });
    }

    return Array.from(teacherMap.values());
  }

  async listContacts(authUser: AuthUser): Promise<MessagingContact[]> {
    this.ensureEnabled();
    const userDoc = await this.getAuthUserDocument(authUser);

    this.ensureAllowedRole(userDoc.role);

    if (userDoc.role === UserRole.TEACHER) {
      return this.getContactsForTeacher(authUser, userDoc);
    }

    if (userDoc.role === UserRole.STUDENT) {
      const student = await Student.findOne({
        userId: userDoc._id,
        schoolId: userDoc.schoolId,
        isActive: true,
      }).populate({
        path: "userId",
        select: "firstName lastName role username",
      });

      if (!student) {
        throw new AppError(httpStatus.FORBIDDEN, "Student profile not found");
      }

      return this.getContactsForStudent(userDoc, student);
    }

    if (userDoc.role === UserRole.PARENT) {
      const parent = await this.getParentByUserId(
        normalizeObjectId(userDoc.schoolId!),
        userDoc._id
      );
      return this.getContactsForParent(userDoc, parent);
    }

    throw new AppError(httpStatus.FORBIDDEN, "Role not supported");
  }

  private async resolveContextStudent(
    schoolId: Types.ObjectId,
    contextStudentId?: string
  ): Promise<IStudentDocument | null> {
    if (!contextStudentId) {
      return null;
    }
    return this.getStudentById(schoolId, normalizeObjectId(contextStudentId));
  }

  private ensureConversationComposition(
    participants: IUserDocument[],
    currentUser: IUserDocument,
    contextStudent: IStudentDocument | null
  ) {
    const roles = participants.map((p) => p.role as UserRole);
    roles.forEach((role) => this.ensureAllowedRole(role));

    const teacherCount = roles.filter(
      (role) => role === UserRole.TEACHER
    ).length;
    if (!teacherCount) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "A conversation must include at least one teacher"
      );
    }

    const involvesStudentOrParent = roles.some((role) =>
      [UserRole.STUDENT, UserRole.PARENT].includes(role)
    );

    if (involvesStudentOrParent && !contextStudent) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "A related student must be specified"
      );
    }

    if (!participants.some((p) => p._id.equals(currentUser._id))) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "You must be part of the conversation"
      );
    }
  }

  async createConversation(
    authUser: AuthUser,
    payload: CreateConversationPayload
  ): Promise<ConversationSummary> {
    this.ensureEnabled();
    const requester = await this.getAuthUserDocument(authUser);
    const schoolObjectId = normalizeObjectId(requester.schoolId!);

    const participantIds = new Set<string>(
      payload.participantIds.map((id) => normalizeObjectId(id).toString())
    );
    participantIds.add(requester._id.toString());

    if (participantIds.size < 2) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "A conversation requires at least two participants"
      );
    }

    const participants = await User.find({
      _id: { $in: Array.from(participantIds) },
      schoolId: schoolObjectId,
      isActive: true,
    }).lean();

    if (participants.length !== participantIds.size) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "One or more participants could not be found in this school"
      );
    }

    const participantDocs = participants as IUserDocument[];

    const contextStudent = await this.resolveContextStudent(
      schoolObjectId,
      payload.contextStudentId
    );

    this.ensureConversationComposition(
      participantDocs,
      requester,
      contextStudent
    );

    if (contextStudent) {
      // Ensure the student belongs to the same school
      if (!contextStudent.schoolId.equals(schoolObjectId)) {
        throw new AppError(
          httpStatus.FORBIDDEN,
          "Student does not belong to this school"
        );
      }

      const parentParticipants = participantDocs.filter(
        (participant) => participant.role === UserRole.PARENT
      );

      if (parentParticipants.length) {
        await Promise.all(
          parentParticipants.map(async (parentUser) => {
            const parentDoc = await Parent.findOne({
              schoolId: schoolObjectId,
              userId: parentUser._id,
              isActive: true,
            })
              .select("children")
              .lean();

            if (
              !parentDoc ||
              !parentDoc.children?.some(
                (childId) =>
                  childId.toString() === contextStudent._id.toString()
              )
            ) {
              throw new AppError(
                httpStatus.FORBIDDEN,
                "Parent is not linked to the specified student"
              );
            }
          })
        );
      }

      // Teacher validation
      await Promise.all(
        participantDocs
          .filter((participant) => participant.role === UserRole.TEACHER)
          .map((teacherUser) =>
            this.ensureTeacherCanAccessStudent(
              schoolObjectId,
              teacherUser._id,
              contextStudent
            )
          )
      );
    }

    const participantObjectIds = participantDocs.map((participant) =>
      normalizeObjectId(participant._id)
    );
    const participantHash = this.buildParticipantHash(participantObjectIds);

    const contextType: MessagingContextType = contextStudent
      ? "student-thread"
      : "direct";

    const existingConversation = await Conversation.findOne({
      schoolId: schoolObjectId,
      participantHash,
      contextType,
      contextStudentId: contextStudent ? contextStudent._id : null,
    });

    const conversation =
      existingConversation ??
      (await Conversation.create({
        schoolId: schoolObjectId,
        participantIds: participantDocs.map((doc) => ({
          userId: doc._id,
          role: doc.role,
          addedAt: new Date(),
        })),
        participantHash,
        contextType,
        contextStudentId: contextStudent ? contextStudent._id : undefined,
        lastMessageAt: undefined,
        lastMessagePreview: undefined,
      }));

    return this.buildConversationSummary(conversation, requester);
  }

  private async buildConversationSummary(
    conversationDoc: typeof Conversation.prototype,
    requester: IUserDocument
  ): Promise<ConversationSummary> {
    const conversation = await Conversation.findById(conversationDoc._id);
    if (!conversation) {
      throw new AppError(httpStatus.NOT_FOUND, "Conversation not found");
    }

    const conversationId = (conversation._id as Types.ObjectId).toString();
    const conversationObject = conversation.toObject();

    const userIds = conversationObject.participantIds.map(
      (p) => p.userId as Types.ObjectId
    );
    const userSummaries = await this.loadUserSummaries(userIds);

    let contextStudentSummary: ConversationSummary["contextStudent"] = null;
    if (conversationObject.contextStudentId) {
      const student = await Student.findById(
        conversationObject.contextStudentId
      ).populate("userId", "firstName lastName");
      if (student) {
        const studentUser = isPopulatedUser(student.userId)
          ? student.userId
          : undefined;
        const studentName = studentUser
          ? `${studentUser.firstName ?? ""} ${
              studentUser.lastName ?? ""
            }`.trim()
          : "Student";
        contextStudentSummary = {
          studentId: student._id.toString(),
          studentName: studentName || "Student",
        };
      }
    }

    return {
      id: conversationId,
      contextType: conversationObject.contextType,
      contextStudent: contextStudentSummary,
      lastMessageAt: conversationObject.lastMessageAt ?? undefined,
      lastMessagePreview: conversationObject.lastMessagePreview ?? undefined,
      participants: conversationObject.participantIds.map((participant) => {
        const summary = userSummaries.get(participant.userId.toString());
        return {
          userId: participant.userId.toString(),
          role: participant.role,
          fullName: summary?.fullName ?? "Unknown",
          isSelf: participant.userId.toString() === requester._id.toString(),
        };
      }),
    };
  }

  async listConversations(authUser: AuthUser): Promise<ConversationSummary[]> {
    this.ensureEnabled();
    const requester = await this.getAuthUserDocument(authUser);
    const schoolObjectId = normalizeObjectId(requester.schoolId!);

    const conversations = await Conversation.find({
      schoolId: schoolObjectId,
      "participantIds.userId": requester._id,
    })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .limit(200);

    const summaries: ConversationSummary[] = [];
    for (const conversation of conversations) {
      const summary = await this.buildConversationSummary(
        conversation,
        requester
      );
      summaries.push(summary);
    }
    return summaries;
  }

  private async authorizeConversationAccess(
    conversationId: string,
    requester: IUserDocument
  ) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new AppError(httpStatus.NOT_FOUND, "Conversation not found");
    }

    const isParticipant = conversation.participantIds.some(
      (participant) =>
        participant.userId.toString() === requester._id.toString()
    );
    if (!isParticipant) {
      throw new AppError(httpStatus.FORBIDDEN, "Access denied");
    }
    return conversation;
  }

  async listMessages(
    authUser: AuthUser,
    conversationId: string,
    query: ListMessagesQuery
  ): Promise<{ messages: MessageSummary[]; nextCursor?: Date }> {
    this.ensureEnabled();
    const requester = await this.getAuthUserDocument(authUser);
    const conversation = await this.authorizeConversationAccess(
      conversationId,
      requester
    );
    const conversationIdString = (
      conversation._id as Types.ObjectId
    ).toString();

    const limit = Math.min(query.limit ?? 50, 100);

    const filter: FilterQuery<typeof Message> = {
      conversationId: conversation._id,
      schoolId: conversation.schoolId,
    };
    if (query.cursor) {
      filter.createdAt = { $lt: query.cursor };
    }

    const messages = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = messages.length > limit;
    const trimmed = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore
      ? trimmed[trimmed.length - 1].createdAt
      : undefined;

    return {
      messages: trimmed.reverse().map((message) => ({
        id: String(message._id),
        conversationId: conversationIdString,
        senderId: (message.senderId as Types.ObjectId).toString(),
        body: message.body,
        createdAt: message.createdAt,
      })),
      nextCursor,
    };
  }

  async sendMessage(
    authUser: AuthUser,
    conversationId: string,
    body: string
  ): Promise<MessageSummary> {
    this.ensureEnabled();
    const requester = await this.getAuthUserDocument(authUser);
    const conversation = await this.authorizeConversationAccess(
      conversationId,
      requester
    );

    const trimmedBody = body.trim();
    if (!trimmedBody.length) {
      throw new AppError(httpStatus.BAD_REQUEST, "Message cannot be empty");
    }
    if (trimmedBody.length > config.messaging_max_body_length) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Message cannot exceed ${config.messaging_max_body_length} characters`
      );
    }

    const message = await Message.create({
      conversationId: conversation._id,
      schoolId: conversation.schoolId,
      senderId: requester._id,
      body: trimmedBody,
      createdAt: new Date(),
    });

    conversation.lastMessageAt = message.createdAt;
    conversation.lastMessagePreview = sanitizePreview(trimmedBody);
    conversation.updatedAt = new Date();
    await conversation.save();

    const conversationIdString = (
      conversation._id as Types.ObjectId
    ).toString();

    return {
      id: String(message._id),
      conversationId: conversationIdString,
      senderId: requester._id.toString(),
      body: message.body,
      createdAt: message.createdAt,
    };
  }
}

export const messagingService = new MessagingService();
