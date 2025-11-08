"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.messagingService = void 0;
const mongoose_1 = require("mongoose");
const http_status_1 = __importDefault(require("http-status"));
const config_1 = __importDefault(require("../../config"));
const AppError_1 = require("../../errors/AppError");
const messaging_model_1 = require("./messaging.model");
const user_model_1 = require("../user/user.model");
const user_interface_1 = require("../user/user.interface");
const teacher_model_1 = require("../teacher/teacher.model");
const student_model_1 = require("../student/student.model");
const parent_model_1 = require("../parent/parent.model");
const schedule_model_1 = require("../schedule/schedule.model");
const MAX_CONTACTS = 1000;
const sanitizePreview = (body) => body.length <= 180 ? body : `${body.slice(0, 177)}...`;
const normalizeObjectId = (value) => {
    if (value instanceof mongoose_1.Types.ObjectId) {
        return value;
    }
    if (typeof value === "string" && mongoose_1.Types.ObjectId.isValid(value)) {
        return new mongoose_1.Types.ObjectId(value);
    }
    throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Invalid identifier");
};
const isPopulatedUser = (value) => !!value && typeof value === "object" && "role" in value;
const isPopulatedStudent = (value) => !!value && typeof value === "object" && "grade" in value;
class MessagingService {
    ensureEnabled() {
        if (!config_1.default.messaging_enabled) {
            throw new AppError_1.AppError(http_status_1.default.SERVICE_UNAVAILABLE, "Messaging is disabled for this environment");
        }
    }
    async getAuthUserDocument(user) {
        const userDoc = await user_model_1.User.findById(user.id);
        if (!userDoc) {
            throw new AppError_1.AppError(http_status_1.default.UNAUTHORIZED, "User context missing");
        }
        if (!userDoc.schoolId) {
            throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "User is not associated with a school");
        }
        return userDoc;
    }
    async getTeacherByUserId(schoolId, userId) {
        const teacher = await teacher_model_1.Teacher.findOne({
            schoolId,
            userId,
        });
        if (!teacher) {
            throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, "Teacher profile not found");
        }
        return teacher;
    }
    async getStudentById(schoolId, studentId) {
        const student = await student_model_1.Student.findOne({
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
            throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Student not found");
        }
        return student;
    }
    async getParentByUserId(schoolId, userId) {
        const parent = await parent_model_1.Parent.findOne({
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
            throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, "Parent profile not found");
        }
        return parent;
    }
    async loadUserSummaries(userIds) {
        if (!userIds.length) {
            return new Map();
        }
        const users = await user_model_1.User.find({
            _id: { $in: userIds },
        })
            .select("firstName lastName role")
            .lean();
        const map = new Map();
        users.forEach((u) => {
            const fullName = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
            map.set(u._id.toString(), {
                fullName: fullName || u.firstName || "Unnamed",
                role: u.role,
            });
        });
        return map;
    }
    buildParticipantHash(userIds) {
        return userIds
            .map((id) => id.toString())
            .sort()
            .join("|");
    }
    ensureAllowedRole(role) {
        const allowed = [
            user_interface_1.UserRole.TEACHER,
            user_interface_1.UserRole.STUDENT,
            user_interface_1.UserRole.PARENT,
        ];
        if (!allowed.includes(role)) {
            throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, "Messaging is restricted to teachers, students, and parents");
        }
    }
    async ensureTeacherCanAccessStudent(schoolId, teacherUserId, student) {
        const teacher = await this.getTeacherByUserId(schoolId, teacherUserId);
        const assignmentExists = await schedule_model_1.Schedule.exists({
            schoolId,
            isActive: true,
            grade: student.grade,
            section: student.section,
            "periods.teacherId": teacher._id,
        });
        if (!assignmentExists) {
            throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, "Teacher is not assigned to this student");
        }
        return teacher;
    }
    formatContact(user, role, relatedStudents) {
        const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
        return {
            userId: user._id.toString(),
            role,
            fullName: fullName || user.username,
            relatedStudents,
        };
    }
    async getContactsForTeacher(authUser, userDoc) {
        const schoolObjectId = normalizeObjectId(userDoc.schoolId);
        const teacher = await this.getTeacherByUserId(schoolObjectId, userDoc._id);
        const schedules = await schedule_model_1.Schedule.find({
            schoolId: schoolObjectId,
            isActive: true,
            "periods.teacherId": teacher._id,
        })
            .select("grade section")
            .lean();
        if (!schedules.length) {
            return [];
        }
        const gradeSections = new Map();
        schedules.forEach((schedule) => {
            const key = `${schedule.grade}|${schedule.section}`;
            if (!gradeSections.has(key)) {
                gradeSections.set(key, {
                    grade: schedule.grade,
                    section: schedule.section,
                });
            }
        });
        const gradeSectionFilters = Array.from(gradeSections.values()).map(({ grade, section }) => ({ grade, section }));
        const students = await student_model_1.Student.find({
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
        const contacts = [];
        const parentMap = new Map();
        students.forEach((studentDoc) => {
            const studentUser = isPopulatedUser(studentDoc.userId)
                ? studentDoc.userId
                : undefined;
            if (!studentUser) {
                return;
            }
            const studentName = `${studentUser.firstName ?? ""} ${studentUser.lastName ?? ""}`.trim();
            contacts.push({
                userId: studentUser._id.toString(),
                role: user_interface_1.UserRole.STUDENT,
                fullName: studentName || studentUser.username,
                relatedStudents: [
                    {
                        studentId: studentDoc._id.toString(),
                        studentName: studentName || "Student",
                    },
                ],
            });
            const parentDoc = studentDoc.parentId;
            if (parentDoc?.userId && isPopulatedUser(parentDoc.userId)) {
                const parentUser = parentDoc.userId;
                const parentKey = parentUser._id.toString();
                const entry = parentMap.get(parentKey) ??
                    this.formatContact(parentUser, user_interface_1.UserRole.PARENT, []);
                entry.relatedStudents.push({
                    studentId: studentDoc._id.toString(),
                    studentName: studentName || "Student",
                });
                parentMap.set(parentKey, entry);
            }
        });
        return [...contacts, ...Array.from(parentMap.values())];
    }
    async getContactsForStudent(userDoc, student) {
        const schoolObjectId = normalizeObjectId(userDoc.schoolId);
        const schedules = await schedule_model_1.Schedule.find({
            schoolId: schoolObjectId,
            isActive: true,
            grade: student.grade,
            section: student.section,
        })
            .select("periods.teacherId")
            .lean();
        const teacherIds = new Set();
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
        const teachers = await teacher_model_1.Teacher.find({
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
            const fullName = `${teacherUser.firstName ?? ""} ${teacherUser.lastName ?? ""}`.trim();
            return {
                userId: teacherUser._id.toString(),
                role: user_interface_1.UserRole.TEACHER,
                fullName: fullName || teacherUser.username,
                relatedStudents: [
                    {
                        studentId: student._id.toString(),
                        studentName: `${student.userId?.firstName ?? ""} ${student.userId?.lastName ?? ""}`.trim() || "Student",
                    },
                ],
            };
        })
            .filter(Boolean);
    }
    async getContactsForParent(userDoc, parent) {
        const schoolObjectId = normalizeObjectId(userDoc.schoolId);
        const childEntries = parent.children ?? [];
        if (!childEntries.length) {
            return [];
        }
        const teacherMap = new Map();
        for (const childRef of childEntries) {
            let populatedChild = null;
            if (isPopulatedStudent(childRef)) {
                populatedChild = childRef;
            }
            else if (childRef instanceof mongoose_1.Types.ObjectId) {
                populatedChild = await student_model_1.Student.findById(childRef).populate({
                    path: "userId",
                    select: "firstName lastName role username",
                });
            }
            if (!populatedChild) {
                continue;
            }
            const contactLabel = `${populatedChild.userId?.firstName ?? ""} ${populatedChild.userId?.lastName ?? ""}`.trim() || "Student";
            const teacherContacts = await this.getContactsForStudent(userDoc, populatedChild);
            teacherContacts.forEach((teacherContact) => {
                const existing = teacherMap.get(teacherContact.userId);
                if (existing) {
                    if (!existing.relatedStudents.some((rs) => rs.studentId === populatedChild._id.toString())) {
                        existing.relatedStudents.push({
                            studentId: populatedChild._id.toString(),
                            studentName: contactLabel,
                        });
                    }
                }
                else {
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
    async listContacts(authUser) {
        this.ensureEnabled();
        const userDoc = await this.getAuthUserDocument(authUser);
        this.ensureAllowedRole(userDoc.role);
        if (userDoc.role === user_interface_1.UserRole.TEACHER) {
            return this.getContactsForTeacher(authUser, userDoc);
        }
        if (userDoc.role === user_interface_1.UserRole.STUDENT) {
            const student = await student_model_1.Student.findOne({
                userId: userDoc._id,
                schoolId: userDoc.schoolId,
                isActive: true,
            }).populate({
                path: "userId",
                select: "firstName lastName role username",
            });
            if (!student) {
                throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, "Student profile not found");
            }
            return this.getContactsForStudent(userDoc, student);
        }
        if (userDoc.role === user_interface_1.UserRole.PARENT) {
            const parent = await this.getParentByUserId(normalizeObjectId(userDoc.schoolId), userDoc._id);
            return this.getContactsForParent(userDoc, parent);
        }
        throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, "Role not supported");
    }
    async resolveContextStudent(schoolId, contextStudentId) {
        if (!contextStudentId) {
            return null;
        }
        return this.getStudentById(schoolId, normalizeObjectId(contextStudentId));
    }
    ensureConversationComposition(participants, currentUser, contextStudent) {
        const roles = participants.map((p) => p.role);
        roles.forEach((role) => this.ensureAllowedRole(role));
        const teacherCount = roles.filter((role) => role === user_interface_1.UserRole.TEACHER).length;
        if (!teacherCount) {
            throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "A conversation must include at least one teacher");
        }
        const involvesStudentOrParent = roles.some((role) => [user_interface_1.UserRole.STUDENT, user_interface_1.UserRole.PARENT].includes(role));
        if (involvesStudentOrParent && !contextStudent) {
            throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "A related student must be specified");
        }
        if (!participants.some((p) => p._id.equals(currentUser._id))) {
            throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, "You must be part of the conversation");
        }
    }
    async createConversation(authUser, payload) {
        this.ensureEnabled();
        const requester = await this.getAuthUserDocument(authUser);
        const schoolObjectId = normalizeObjectId(requester.schoolId);
        const participantIds = new Set(payload.participantIds.map((id) => normalizeObjectId(id).toString()));
        participantIds.add(requester._id.toString());
        if (participantIds.size < 2) {
            throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "A conversation requires at least two participants");
        }
        const participants = await user_model_1.User.find({
            _id: { $in: Array.from(participantIds) },
            schoolId: schoolObjectId,
            isActive: true,
        }).lean();
        if (participants.length !== participantIds.size) {
            throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "One or more participants could not be found in this school");
        }
        const participantDocs = participants;
        const contextStudent = await this.resolveContextStudent(schoolObjectId, payload.contextStudentId);
        this.ensureConversationComposition(participantDocs, requester, contextStudent);
        if (contextStudent) {
            if (!contextStudent.schoolId.equals(schoolObjectId)) {
                throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, "Student does not belong to this school");
            }
            const parentParticipants = participantDocs.filter((participant) => participant.role === user_interface_1.UserRole.PARENT);
            if (parentParticipants.length) {
                await Promise.all(parentParticipants.map(async (parentUser) => {
                    const parentDoc = await parent_model_1.Parent.findOne({
                        schoolId: schoolObjectId,
                        userId: parentUser._id,
                        isActive: true,
                    })
                        .select("children")
                        .lean();
                    if (!parentDoc ||
                        !parentDoc.children?.some((childId) => childId.toString() === contextStudent._id.toString())) {
                        throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, "Parent is not linked to the specified student");
                    }
                }));
            }
            await Promise.all(participantDocs
                .filter((participant) => participant.role === user_interface_1.UserRole.TEACHER)
                .map((teacherUser) => this.ensureTeacherCanAccessStudent(schoolObjectId, teacherUser._id, contextStudent)));
        }
        const participantObjectIds = participantDocs.map((participant) => normalizeObjectId(participant._id));
        const participantHash = this.buildParticipantHash(participantObjectIds);
        const contextType = contextStudent
            ? "student-thread"
            : "direct";
        const existingConversation = await messaging_model_1.Conversation.findOne({
            schoolId: schoolObjectId,
            participantHash,
            contextType,
            contextStudentId: contextStudent ? contextStudent._id : null,
        });
        const conversation = existingConversation ??
            (await messaging_model_1.Conversation.create({
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
    async buildConversationSummary(conversationDoc, requester) {
        const conversation = await messaging_model_1.Conversation.findById(conversationDoc._id);
        if (!conversation) {
            throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Conversation not found");
        }
        const conversationId = conversation._id.toString();
        const conversationObject = conversation.toObject();
        const userIds = conversationObject.participantIds.map((p) => p.userId);
        const userSummaries = await this.loadUserSummaries(userIds);
        let contextStudentSummary = null;
        if (conversationObject.contextStudentId) {
            const student = await student_model_1.Student.findById(conversationObject.contextStudentId).populate("userId", "firstName lastName");
            if (student) {
                const studentUser = isPopulatedUser(student.userId)
                    ? student.userId
                    : undefined;
                const studentName = studentUser
                    ? `${studentUser.firstName ?? ""} ${studentUser.lastName ?? ""}`.trim()
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
    async listConversations(authUser) {
        this.ensureEnabled();
        const requester = await this.getAuthUserDocument(authUser);
        const schoolObjectId = normalizeObjectId(requester.schoolId);
        const conversations = await messaging_model_1.Conversation.find({
            schoolId: schoolObjectId,
            "participantIds.userId": requester._id,
        })
            .sort({ lastMessageAt: -1, updatedAt: -1 })
            .limit(200);
        const summaries = [];
        for (const conversation of conversations) {
            const summary = await this.buildConversationSummary(conversation, requester);
            summaries.push(summary);
        }
        return summaries;
    }
    async authorizeConversationAccess(conversationId, requester) {
        const conversation = await messaging_model_1.Conversation.findById(conversationId);
        if (!conversation) {
            throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Conversation not found");
        }
        const isParticipant = conversation.participantIds.some((participant) => participant.userId.toString() === requester._id.toString());
        if (!isParticipant) {
            throw new AppError_1.AppError(http_status_1.default.FORBIDDEN, "Access denied");
        }
        return conversation;
    }
    async listMessages(authUser, conversationId, query) {
        this.ensureEnabled();
        const requester = await this.getAuthUserDocument(authUser);
        const conversation = await this.authorizeConversationAccess(conversationId, requester);
        const conversationIdString = conversation._id.toString();
        const limit = Math.min(query.limit ?? 50, 100);
        const filter = {
            conversationId: conversation._id,
            schoolId: conversation.schoolId,
        };
        if (query.cursor) {
            filter.createdAt = { $lt: query.cursor };
        }
        const messages = await messaging_model_1.Message.find(filter)
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
                senderId: message.senderId.toString(),
                body: message.body,
                createdAt: message.createdAt,
            })),
            nextCursor,
        };
    }
    async sendMessage(authUser, conversationId, body) {
        this.ensureEnabled();
        const requester = await this.getAuthUserDocument(authUser);
        const conversation = await this.authorizeConversationAccess(conversationId, requester);
        const trimmedBody = body.trim();
        if (!trimmedBody.length) {
            throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Message cannot be empty");
        }
        if (trimmedBody.length > config_1.default.messaging_max_body_length) {
            throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, `Message cannot exceed ${config_1.default.messaging_max_body_length} characters`);
        }
        const message = await messaging_model_1.Message.create({
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
        const conversationIdString = conversation._id.toString();
        return {
            id: String(message._id),
            conversationId: conversationIdString,
            senderId: requester._id.toString(),
            body: message.body,
            createdAt: message.createdAt,
        };
    }
}
exports.messagingService = new MessagingService();
//# sourceMappingURL=messaging.service.js.map