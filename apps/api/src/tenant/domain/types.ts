export type TenantStatus = 'draft' | 'active' | 'suspended' | 'grace_period' | 'archived' | 'deleted';

export type InstitutionType =
  | 'university'
  | 'school'
  | 'training_centre'
  | 'corporate'
  | 'non_profit'
  | 'government'
  | 'academy'
  | 'custom';

export interface Institution {
  id: string;
  name: string;
  type: InstitutionType;
  status: TenantStatus;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InstitutionSettings {
  institutionId: string;
  branding: {
    name: string;
    logoUrl: string | null;
    primaryColor: string | null;
  };
  language: string;
  rtl: boolean;
  terminology: Record<string, string>;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type MembershipStatus = 'pending' | 'active' | 'inactive' | 'suspended' | 'ended';

export interface Membership {
  id: string;
  institutionId: string;
  userId: string;
  status: MembershipStatus;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface Invitation {
  id: string;
  institutionId: string;
  tokenHash: string;
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  acceptedByUserId: string | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}
