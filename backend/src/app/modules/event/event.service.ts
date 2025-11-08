import { Types } from "mongoose";
import { Event } from "./event.model";
import { IEvent, IEventFilters } from "./event.interface";
import { AppError } from "../../errors/AppError";
// Fixed grade/section filtering for students

const createEvent = async (
  eventData: IEvent,
  userId: Types.ObjectId
): Promise<any> => {
  const event = new Event({
    ...eventData,
    createdBy: userId,
  });

  await event.save();
  return event.populate([
    { path: "schoolId", select: "name" },
    { path: "createdBy", select: "firstName lastName" },
  ]);
};

const getEvents = async (
  schoolId: Types.ObjectId,
  userRole: string,
  userGrade?: number,
  userSection?: string,
  filters?: any
): Promise<{ events: any[]; total: number; page: number; limit: number }> => {
  const {
    type,
    startDate,
    endDate,
    grade,
    section,
    page = 1,
    limit = 20,
    isActive = true,
  } = filters || {};

  // Build query
  const query: IEventFilters = {
    isActive,
    "targetAudience.roles": { $in: [userRole] },
  };

  // Only filter by schoolId if user is not a superadmin
  if (
    userRole !== "superadmin" &&
    schoolId &&
    schoolId.toString() !== "system"
  ) {
    query.schoolId = schoolId;
  }

  // Filter by type
  if (type) {
    query.type = type;
  }

  // Filter by date range
  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }

  // Filter by grade/section for specific user context
  if (userRole === "student" || userRole === "parent") {
    // Build grade/section filter - empty arrays mean "all grades/sections"
    const gradeConditions: any[] = [];
    const sectionConditions: any[] = [];

    if (userGrade) {
      gradeConditions.push(
        { "targetAudience.grades": { $size: 0 } }, // Empty array = all grades
        { "targetAudience.grades": { $in: [userGrade] } } // Specific grade included
      );
    }

    if (userSection) {
      sectionConditions.push(
        { "targetAudience.sections": { $size: 0 } }, // Empty array = all sections
        { "targetAudience.sections": { $in: [userSection] } } // Specific section included
      );
    }

    // Apply conditions using type assertion for MongoDB operators
    const mongoQuery = query as any;
    if (gradeConditions.length > 0 && sectionConditions.length > 0) {
      mongoQuery.$and = mongoQuery.$and || [];
      mongoQuery.$and.push(
        { $or: gradeConditions },
        { $or: sectionConditions }
      );
    } else if (gradeConditions.length > 0) {
      mongoQuery.$or = gradeConditions;
    } else if (sectionConditions.length > 0) {
      mongoQuery.$or = sectionConditions;
    }
  }

  // Filter by grade/section from query parameters (admin/teacher view)
  if (grade && (userRole === "admin" || userRole === "teacher")) {
    query["targetAudience.grades"] = { $in: [grade] };
  }
  if (section && (userRole === "admin" || userRole === "teacher")) {
    query["targetAudience.sections"] = { $in: [section] };
  }

  const skip = (page - 1) * limit;

  const [events, total] = await Promise.all([
    Event.find(query)
      .populate([
        { path: "schoolId", select: "name" },
        { path: "createdBy", select: "firstName lastName" },
      ])
      .sort({ date: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Event.countDocuments(query),
  ]);

  return {
    events,
    total,
    page,
    limit,
  };
};

const getTodaysEvents = async (
  schoolId: Types.ObjectId,
  userRole: string,
  userGrade?: number,
  userSection?: string
): Promise<any[]> => {
  const today = new Date();
  const startOfDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const endOfDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    23,
    59,
    59
  );

  const query: IEventFilters = {
    isActive: true,
    "targetAudience.roles": { $in: [userRole] },
    date: {
      $gte: startOfDay,
      $lte: endOfDay,
    },
  };

  // Only filter by schoolId if user is not a superadmin
  if (
    userRole !== "superadmin" &&
    schoolId &&
    schoolId.toString() !== "system"
  ) {
    query.schoolId = schoolId;
  }

  // Filter by user context
  if (userRole === "student" || userRole === "parent") {
    // Build grade/section filter - empty arrays mean "all grades/sections"
    const gradeConditions: any[] = [];
    const sectionConditions: any[] = [];

    if (userGrade) {
      gradeConditions.push(
        { "targetAudience.grades": { $size: 0 } }, // Empty array = all grades
        { "targetAudience.grades": { $in: [userGrade] } } // Specific grade included
      );
    }

    if (userSection) {
      sectionConditions.push(
        { "targetAudience.sections": { $size: 0 } }, // Empty array = all sections
        { "targetAudience.sections": { $in: [userSection] } } // Specific section included
      );
    }

    // Apply conditions using type assertion for MongoDB operators
    const mongoQuery = query as any;
    if (gradeConditions.length > 0 && sectionConditions.length > 0) {
      mongoQuery.$and = mongoQuery.$and || [];
      mongoQuery.$and.push(
        { $or: gradeConditions },
        { $or: sectionConditions }
      );
    } else if (gradeConditions.length > 0) {
      mongoQuery.$or = gradeConditions;
    } else if (sectionConditions.length > 0) {
      mongoQuery.$or = sectionConditions;
    }
  }

  return Event.find(query)
    .populate([
      { path: "schoolId", select: "name" },
      { path: "createdBy", select: "firstName lastName" },
    ])
    .sort({ time: 1, createdAt: -1 })
    .lean();
};

const getEventById = async (
  id: string,
  schoolId: Types.ObjectId
): Promise<any> => {
  const event = await Event.findOne({ _id: id, schoolId })
    .populate([
      { path: "schoolId", select: "name" },
      { path: "createdBy", select: "firstName lastName" },
    ])
    .lean();

  if (!event) {
    throw new AppError(404, "Event not found");
  }

  return event;
};

const updateEvent = async (
  id: string,
  updateData: Partial<IEvent>,
  schoolId: Types.ObjectId,
  userId: Types.ObjectId
): Promise<any> => {
  const event = await Event.findOne({ _id: id, schoolId });

  if (!event) {
    throw new AppError(404, "Event not found");
  }

  // Check if user can update this event (only creator or admin)
  const user = await Event.findById(userId);
  if (event.createdBy.toString() !== userId.toString() && user) {
    // Add role check here if needed
  }

  Object.assign(event, updateData);
  await event.save();

  return event.populate([
    { path: "schoolId", select: "name" },
    { path: "createdBy", select: "firstName lastName" },
  ]);
};

const deleteEvent = async (
  id: string,
  schoolId: Types.ObjectId,
  userId: Types.ObjectId
): Promise<void> => {
  const event = await Event.findOne({ _id: id, schoolId });

  if (!event) {
    throw new AppError(404, "Event not found");
  }

  // Check if user can delete this event (only creator or admin)
  if (event.createdBy.toString() !== userId.toString()) {
    // Add role check here if needed for admin override
  }

  await Event.findByIdAndDelete(id);
};

const getUpcomingEvents = async (
  schoolId: Types.ObjectId,
  userRole: string,
  userGrade?: number,
  userSection?: string,
  limit: number = 5
): Promise<any[]> => {
  const now = new Date();

  const query: IEventFilters = {
    isActive: true,
    "targetAudience.roles": { $in: [userRole] },
    date: { $gte: now },
  };

  // Only filter by schoolId if user is not a superadmin
  if (
    userRole !== "superadmin" &&
    schoolId &&
    schoolId.toString() !== "system"
  ) {
    query.schoolId = schoolId;
  }

  // Filter by user context
  if (userRole === "student" || userRole === "parent") {
    if (userGrade) {
      query["targetAudience.grades"] = { $in: [userGrade] };
    }
    if (userSection) {
      query["targetAudience.sections"] = { $in: [userSection] };
    }
  }

  return Event.find(query)
    .populate([
      { path: "schoolId", select: "name" },
      { path: "createdBy", select: "firstName lastName" },
    ])
    .sort({ date: 1, time: 1 })
    .limit(limit)
    .lean();
};

export const eventService = {
  createEvent,
  getEvents,
  getTodaysEvents,
  getEventById,
  updateEvent,
  deleteEvent,
  getUpcomingEvents,
};
