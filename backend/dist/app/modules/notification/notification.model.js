"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Notification = void 0;
const mongoose_1 = require("mongoose");
const notificationSchema = new mongoose_1.Schema({
    schoolId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "School",
        required: true,
        index: true,
    },
    recipientId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },
    recipientType: {
        type: String,
        enum: ["parent", "student", "teacher", "admin"],
        required: true,
    },
    senderId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    senderType: {
        type: String,
        enum: ["teacher", "admin", "system"],
        required: true,
    },
    type: {
        type: String,
        enum: [
            "attendance_alert",
            "homework_assigned",
            "grade_published",
            "announcement",
            "warning",
            "disciplinary_warning",
            "red_warrant",
            "punishment_issued",
        ],
        required: true,
        index: true,
    },
    title: {
        type: String,
        required: true,
    },
    message: {
        type: String,
        required: true,
    },
    data: {
        type: mongoose_1.Schema.Types.Mixed,
    },
    priority: {
        type: String,
        enum: ["low", "medium", "high", "urgent"],
        default: "medium",
        index: true,
    },
    isRead: {
        type: Boolean,
        default: false,
        index: true,
    },
    readAt: {
        type: Date,
    },
    relatedEntityId: {
        type: mongoose_1.Schema.Types.ObjectId,
        index: true,
    },
    relatedEntityType: {
        type: String,
    },
    metadata: {
        type: mongoose_1.Schema.Types.Mixed,
    },
}, {
    timestamps: true,
});
notificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ schoolId: 1, type: 1, createdAt: -1 });
notificationSchema.methods.markAsRead = async function () {
    if (!this.isRead) {
        this.isRead = true;
        this.readAt = new Date();
        await this.save();
    }
};
notificationSchema.methods.getTimeAgo = function () {
    const now = new Date();
    const diffInMs = now.getTime() - this.createdAt.getTime();
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    if (diffInMinutes < 1)
        return "Just now";
    if (diffInMinutes < 60)
        return `${diffInMinutes}m ago`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24)
        return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7)
        return `${diffInDays}d ago`;
    return this.createdAt.toLocaleDateString();
};
notificationSchema.statics.createAttendanceAlert = async function (data) {
    const student = await (0, mongoose_1.model)("Student")
        .findById(data.studentId)
        .populate("userId");
    if (!student)
        return [];
    const parents = await (0, mongoose_1.model)("Parent")
        .find({
        associatedStudentId: data.studentId,
    })
        .populate("userId");
    const notifications = [];
    for (const parent of parents) {
        const notification = new this({
            schoolId: student.schoolId,
            recipientId: parent.userId,
            recipientType: "parent",
            senderId: data.teacherId,
            senderType: "teacher",
            type: "attendance_alert",
            title: "Student Absence Alert",
            message: `Your child was marked absent in ${data.subjectName} (${data.className}) on ${data.date.toDateString()}, Period ${data.period}`,
            data: {
                studentId: data.studentId,
                subjectName: data.subjectName,
                className: data.className,
                date: data.date,
                period: data.period,
            },
            priority: "high",
        });
        notifications.push(await notification.save());
    }
    return notifications;
};
notificationSchema.statics.createHomeworkAlert = async function (data) {
    const notifications = [];
    for (const studentId of data.studentIds) {
        const student = await (0, mongoose_1.model)("Student")
            .findById(studentId)
            .populate("userId");
        if (!student)
            continue;
        const parents = await (0, mongoose_1.model)("Parent")
            .find({
            associatedStudentId: studentId,
        })
            .populate("userId");
        for (const parent of parents) {
            const notification = new this({
                schoolId: student.schoolId,
                recipientId: parent.userId,
                recipientType: "parent",
                senderId: data.teacherId,
                senderType: "teacher",
                type: "homework_assigned",
                title: "New Homework Assigned",
                message: `New homework "${data.homeworkTitle}" has been assigned in ${data.subjectName}. Due date: ${data.dueDate.toDateString()}`,
                data: {
                    studentId: studentId,
                    homeworkTitle: data.homeworkTitle,
                    dueDate: data.dueDate,
                    subjectName: data.subjectName,
                },
                priority: "medium",
            });
            notifications.push(await notification.save());
        }
    }
    return notifications;
};
notificationSchema.statics.getUnreadCount = async function (userId) {
    return this.countDocuments({
        recipientId: userId,
        isRead: false,
    });
};
notificationSchema.statics.markAllAsRead = async function (userId) {
    await this.updateMany({ recipientId: userId, isRead: false }, { isRead: true, readAt: new Date() });
};
exports.Notification = (0, mongoose_1.model)("Notification", notificationSchema);
//# sourceMappingURL=notification.model.js.map