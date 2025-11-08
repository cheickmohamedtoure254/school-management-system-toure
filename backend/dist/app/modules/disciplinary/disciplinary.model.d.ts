import { IDisciplinaryActionModel, IPunishmentDocument, IRedWarrantDocument } from "./disciplinary.interface";
export declare const DisciplinaryAction: IDisciplinaryActionModel;
export declare const Punishment: import("mongoose").Model<IPunishmentDocument, {}, {}, {}, import("mongoose").Document<unknown, {}, IPunishmentDocument, {}, {}> & IPunishmentDocument & Required<{
    _id: unknown;
}> & {
    __v: number;
}, any>;
export declare const RedWarrant: import("mongoose").Model<IRedWarrantDocument, {}, {}, {}, import("mongoose").Document<unknown, {}, IRedWarrantDocument, {}, {}> & IRedWarrantDocument & Required<{
    _id: unknown;
}> & {
    __v: number;
}, any>;
//# sourceMappingURL=disciplinary.model.d.ts.map