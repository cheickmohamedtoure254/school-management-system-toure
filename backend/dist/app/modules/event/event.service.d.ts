import { Types } from "mongoose";
import { IEvent } from "./event.interface";
export declare const eventService: {
    createEvent: (eventData: IEvent, userId: Types.ObjectId) => Promise<any>;
    getEvents: (schoolId: Types.ObjectId, userRole: string, userGrade?: number, userSection?: string, filters?: any) => Promise<{
        events: any[];
        total: number;
        page: number;
        limit: number;
    }>;
    getTodaysEvents: (schoolId: Types.ObjectId, userRole: string, userGrade?: number, userSection?: string) => Promise<any[]>;
    getEventById: (id: string, schoolId: Types.ObjectId) => Promise<any>;
    updateEvent: (id: string, updateData: Partial<IEvent>, schoolId: Types.ObjectId, userId: Types.ObjectId) => Promise<any>;
    deleteEvent: (id: string, schoolId: Types.ObjectId, userId: Types.ObjectId) => Promise<void>;
    getUpcomingEvents: (schoolId: Types.ObjectId, userRole: string, userGrade?: number, userSection?: string, limit?: number) => Promise<any[]>;
};
//# sourceMappingURL=event.service.d.ts.map