import httpStatus from "http-status";
import { Types, startSession } from "mongoose";
import { AppError } from "../../errors/AppError";
import { AcademicCalendar } from "./academic-calendar.model";
import {
  ICreateAcademicCalendarRequest,
  IUpdateAcademicCalendarRequest,
  IAcademicCalendarResponse,
  ICalendarStats,
  IExamSchedule,
  ICreateExamScheduleRequest,
} from "./academic-calendar.interface";
import { School } from "../school/school.model";

class AcademicCalendarService {
  async createCalendarEvent(
    eventData: ICreateAcademicCalendarRequest
  ): Promise<IAcademicCalendarResponse> {
    const session = await startSession();
    session.startTransaction();

    try {
      // Verify school exists and is active
      const school = await School.findById(eventData.schoolId);
      if (!school) {
        throw new AppError(httpStatus.NOT_FOUND, "School not found");
      }

      if (school.status !== "active") {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          "Cannot create calendar event for inactive school"
        );
      }

      // Check for overlapping events of same type
      if (eventData.eventType === "exam") {
        const overlappingExam = await AcademicCalendar.findOne({
          schoolId: eventData.schoolId,
          eventType: "exam",
          isActive: true,
          $or: [
            {
              startDate: { $lte: new Date(eventData.startDate) },
              endDate: { $gte: new Date(eventData.startDate) },
            },
            {
              startDate: { $lte: new Date(eventData.endDate) },
              endDate: { $gte: new Date(eventData.endDate) },
            },
          ],
        });

        if (overlappingExam) {
          throw new AppError(
            httpStatus.CONFLICT,
            "Another exam is already scheduled during this period"
          );
        }
      }

      // Map request data to model schema fields
      const mappedEventData = {
        schoolId: eventData.schoolId,
        eventTitle: eventData.title,
        eventDescription: eventData.description,
        eventType: eventData.eventType,
        startDate: new Date(eventData.startDate),
        endDate: new Date(eventData.endDate),
        isAllDay: eventData.isAllDay,
        startTime: eventData.startTime,
        endTime: eventData.endTime,
        venue: eventData.location,
        targetAudience: eventData.targetAudience.allSchool ? "all" : "specific",
        specificAudience: !eventData.targetAudience.allSchool
          ? {
              grades:
                eventData.targetAudience.grades?.map((g) => parseInt(g)) || [],
              sections: eventData.targetAudience.classes || [],
              teacherIds:
                eventData.targetAudience.teachers?.map(
                  (t) => new Types.ObjectId(t)
                ) || [],
              studentIds:
                eventData.targetAudience.students?.map(
                  (s) => new Types.ObjectId(s)
                ) || [],
            }
          : undefined,
        priority: eventData.priority,
        isRecurring: eventData.isRecurring,
        recurrencePattern: eventData.isRecurring
          ? {
              frequency: eventData.recurrence?.frequency || "weekly",
              interval: eventData.recurrence?.interval || 1,
              daysOfWeek:
                (eventData.recurrence?.frequency || "weekly") === "weekly"
                  ? [new Date(eventData.startDate).getDay()] // Default to the start date's day of week
                  : undefined,
              dayOfMonth:
                (eventData.recurrence?.frequency || "weekly") === "monthly"
                  ? new Date(eventData.startDate).getDate()
                  : undefined,
              endDate: eventData.recurrence?.endDate
                ? new Date(eventData.recurrence.endDate)
                : undefined,
              occurrences: eventData.recurrence?.occurrences || 5, // Default to 5 occurrences if no end date
            }
          : undefined,
        color: this.getDefaultColor(eventData.eventType),
        createdBy: eventData.organizerId,
        isActive: eventData.status === "published",
      };

      // Create calendar event
      const newEvent = await AcademicCalendar.create([mappedEventData], {
        session,
      });

      await session.commitTransaction();

      return this.formatCalendarEventResponse(newEvent[0]);
    } catch (error) {
      await session.abortTransaction();
      console.error("Detailed error in createCalendarEvent:", error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to create calendar event"
      );
    } finally {
      session.endSession();
    }
  }

  async getCalendarEvents(queryParams: {
    page: number;
    limit: number;
    schoolId?: string;
    eventType?: string;
    startDate?: string;
    endDate?: string;
    targetAudience?: string;
    isActive?: string;
    search?: string;
    sortBy: string;
    sortOrder: string;
  }): Promise<{
    events: IAcademicCalendarResponse[];
    totalCount: number;
    currentPage: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  }> {
    try {
      const {
        page = 1,
        limit = 20,
        schoolId,
        eventType,
        startDate,
        endDate,
        targetAudience,
        isActive,
        search,
        sortBy = "startDate",
        sortOrder = "asc",
      } = queryParams;

      // Build query
      const query: any = { isActive: isActive !== "false" };

      if (schoolId) {
        query.schoolId = schoolId;
      }

      if (eventType && eventType !== "all") {
        query.eventType = eventType;
      }

      if (targetAudience && targetAudience !== "all") {
        query.targetAudience = targetAudience;
      }

      // Date range filter
      if (startDate || endDate) {
        query.$or = [];
        if (startDate && endDate) {
          query.$or.push({
            startDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
          });
          query.$or.push({
            endDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
          });
        } else if (startDate) {
          query.startDate = { $gte: new Date(startDate) };
        } else if (endDate) {
          query.endDate = { $lte: new Date(endDate) };
        }
      }

      // Search functionality
      if (search) {
        query.$or = [
          { eventTitle: { $regex: search, $options: "i" } },
          { eventDescription: { $regex: search, $options: "i" } },
          { venue: { $regex: search, $options: "i" } },
        ];
      }

      // Build sort object
      const sortObj: any = {};
      sortObj[sortBy] = sortOrder === "desc" ? -1 : 1;

      // Execute query with pagination
      const skip = (page - 1) * limit;
      const events = await AcademicCalendar.find(query)
        .populate("schoolId", "name")
        .populate("createdBy", "firstName lastName username")
        .sort(sortObj)
        .skip(skip)
        .limit(limit)
        .lean();

      const totalCount = await AcademicCalendar.countDocuments(query);
      const totalPages = Math.ceil(totalCount / limit);

      const formattedEvents = events.map((event) =>
        this.formatCalendarEventResponse(event)
      );

      return {
        events: formattedEvents,
        totalCount,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      };
    } catch (error) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to retrieve calendar events"
      );
    }
  }

  async getCalendarEventById(id: string): Promise<IAcademicCalendarResponse> {
    try {
      const event = await AcademicCalendar.findOne({ _id: id, isActive: true })
        .populate("schoolId", "name")
        .populate("createdBy", "firstName lastName username")
        .lean();

      if (!event) {
        throw new AppError(httpStatus.NOT_FOUND, "Calendar event not found");
      }

      return this.formatCalendarEventResponse(event);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to retrieve calendar event"
      );
    }
  }

  async updateCalendarEvent(
    id: string,
    updateData: IUpdateAcademicCalendarRequest
  ): Promise<IAcademicCalendarResponse> {
    try {
      const updatedEvent = await AcademicCalendar.findOneAndUpdate(
        { _id: id, isActive: true },
        { ...updateData, updatedAt: new Date() },
        { new: true, runValidators: true }
      )
        .populate("schoolId", "name")
        .populate("createdBy", "firstName lastName username");

      if (!updatedEvent) {
        throw new AppError(httpStatus.NOT_FOUND, "Calendar event not found");
      }

      return this.formatCalendarEventResponse(updatedEvent);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to update calendar event"
      );
    }
  }

  async deleteCalendarEvent(id: string): Promise<void> {
    try {
      const deletedEvent = await AcademicCalendar.findOneAndUpdate(
        { _id: id, isActive: true },
        { isActive: false, deletedAt: new Date() },
        { new: true }
      );

      if (!deletedEvent) {
        throw new AppError(httpStatus.NOT_FOUND, "Calendar event not found");
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to delete calendar event"
      );
    }
  }

  async getCalendarStats(schoolId: string): Promise<ICalendarStats> {
    try {
      const currentYear = new Date().getFullYear();
      const startOfYear = new Date(currentYear, 0, 1);
      const endOfYear = new Date(currentYear, 11, 31);

      const stats = await AcademicCalendar.aggregate([
        {
          $match: {
            schoolId: new Types.ObjectId(schoolId),
            isActive: true,
            startDate: { $gte: startOfYear, $lte: endOfYear },
          },
        },
        {
          $group: {
            _id: "$eventType",
            count: { $sum: 1 },
            upcoming: {
              $sum: {
                $cond: [{ $gte: ["$startDate", new Date()] }, 1, 0],
              },
            },
          },
        },
      ]);

      const totalEvents = await AcademicCalendar.countDocuments({
        schoolId,
        isActive: true,
        startDate: { $gte: startOfYear, $lte: endOfYear },
      });

      const upcomingEvents = await AcademicCalendar.countDocuments({
        schoolId,
        isActive: true,
        startDate: { $gte: new Date() },
      });

      return {
        totalEvents,
        upcomingEvents,
        eventsByType: stats.reduce((acc, stat) => {
          acc[stat._id] = {
            total: stat.count,
            upcoming: stat.upcoming,
          };
          return acc;
        }, {} as any),
      };
    } catch (error) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to retrieve calendar statistics"
      );
    }
  }

  async createExamSchedule(
    examData: ICreateExamScheduleRequest
  ): Promise<IExamSchedule> {
    const session = await startSession();
    session.startTransaction();

    try {
      // Create main exam period event
      const examEvent = await AcademicCalendar.create(
        [
          {
            schoolId: examData.schoolId,
            eventTitle: examData.examName,
            eventDescription: examData.description,
            eventType: "exam",
            startDate: new Date(examData.startDate),
            endDate: new Date(examData.endDate),
            isAllDay: false,
            targetAudience: "students",
            specificAudience: {
              grades: examData.grades,
            },
            priority: "high",
            color: "#DC2626", // Red color for exams
            createdBy: examData.createdBy,
          },
        ],
        { session }
      );

      // Create individual exam events for each subject
      const examSchedules: any[] = [];
      for (const schedule of examData.examSchedules) {
        const examSchedule = await AcademicCalendar.create(
          [
            {
              schoolId: examData.schoolId,
              eventTitle: `${examData.examName} - ${schedule.subjectName}`,
              eventDescription: `${schedule.subjectName} exam for Grade ${schedule.grade}`,
              eventType: "exam",
              startDate: new Date(schedule.examDate),
              endDate: new Date(schedule.examDate),
              isAllDay: false,
              startTime: schedule.startTime,
              endTime: schedule.endTime,
              targetAudience: "students",
              specificAudience: {
                grades: [schedule.grade],
                sections: schedule.sections,
              },
              priority: "high",
              color: "#DC2626",
              createdBy: examData.createdBy,
              // Custom fields for exam details
              examDetails: {
                subjectId: schedule.subjectId,
                totalMarks: schedule.totalMarks,
                passingMarks: schedule.passingMarks,
                duration: schedule.duration,
                instructions: schedule.instructions,
              },
            },
          ],
          { session }
        );

        examSchedules.push(examSchedule[0]);
      }

      await session.commitTransaction();

      return {
        examPeriod: this.formatCalendarEventResponse(examEvent[0]),
        examSchedules: examSchedules.map((schedule) =>
          this.formatCalendarEventResponse(schedule)
        ),
      };
    } catch (error) {
      await session.abortTransaction();
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to create exam schedule"
      );
    } finally {
      session.endSession();
    }
  }

  private getDefaultColor(eventType: string): string {
    const colors = {
      holiday: "#10B981", // Green
      exam: "#DC2626", // Red
      meeting: "#3B82F6", // Blue
      celebration: "#F59E0B", // Yellow
      sports: "#8B5CF6", // Purple
      academic: "#06B6D4", // Cyan
      other: "#6B7280", // Gray
    };
    return colors[eventType as keyof typeof colors] || colors.other;
  }

  private formatCalendarEventResponse(event: any): IAcademicCalendarResponse {
    const now = new Date();
    const startDate = new Date(event.startDate);
    const endDate = new Date(event.endDate);

    // Calculate duration in minutes
    const duration = event.isAllDay
      ? Math.ceil(
          (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
        ) *
        24 *
        60
      : event.startTime && event.endTime
      ? this.calculateDurationInMinutes(event.startTime, event.endTime)
      : 0;

    // Calculate days until event
    const daysUntilEvent = Math.ceil(
      (startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Determine status
    let status: "upcoming" | "ongoing" | "past";
    if (now < startDate) {
      status = "upcoming";
    } else if (now > endDate) {
      status = "past";
    } else {
      status = "ongoing";
    }

    // Format date range
    const formattedDateRange = this.formatDateRange(
      startDate,
      endDate,
      event.isAllDay
    );

    return {
      id: event._id.toString(),
      schoolId:
        typeof event.schoolId === "object"
          ? event.schoolId._id.toString()
          : event.schoolId.toString(),
      eventTitle: event.eventTitle,
      eventDescription: event.eventDescription,
      eventType: event.eventType,
      startDate: event.startDate,
      endDate: event.endDate,
      isAllDay: event.isAllDay,
      startTime: event.startTime,
      endTime: event.endTime,
      venue: event.venue,
      targetAudience: event.targetAudience,
      specificAudience: event.specificAudience,
      priority: event.priority,
      isRecurring: event.isRecurring,
      recurrencePattern: event.recurrencePattern,
      color: event.color,
      duration,
      daysUntilEvent,
      status,
      formattedDateRange,
      notificationSent: event.notificationSent,
      reminderDays: event.reminderDays,
      isActive: event.isActive,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
      school: event.schoolId?.name
        ? {
            id: event.schoolId._id.toString(),
            name: event.schoolId.name,
          }
        : undefined,
      createdBy: event.createdBy
        ? {
            id: event.createdBy._id?.toString() || event.createdBy.toString(),
            fullName: event.createdBy.firstName
              ? `${event.createdBy.firstName} ${event.createdBy.lastName}`
              : "Unknown",
          }
        : undefined,
      examDetails: event.examDetails,
    };
  }

  private calculateDurationInMinutes(
    startTime: string,
    endTime: string
  ): number {
    const start = new Date(`2000-01-01T${startTime}`);
    const end = new Date(`2000-01-01T${endTime}`);
    return Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60));
  }

  private formatDateRange(
    startDate: Date,
    endDate: Date,
    isAllDay: boolean
  ): string {
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "short",
      day: "numeric",
    };

    const startStr = startDate.toLocaleDateString("en-US", options);
    const endStr = endDate.toLocaleDateString("en-US", options);

    if (startStr === endStr) {
      return startStr;
    } else {
      return `${startStr} - ${endStr}`;
    }
  }
}

export const academicCalendarService = new AcademicCalendarService();
