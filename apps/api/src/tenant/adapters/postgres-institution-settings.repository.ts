import type { TransactionalExecutor } from '@manara/database';
import type { InstitutionSettings } from '../domain/types.js';
import type { InstitutionSettingsRepository } from '../ports/institution-settings.repository.js';

interface BrandingJson {
  name: string;
  logo_url: string | null;
  primary_color: string | null;
}

interface InstitutionSettingsRow {
  tenant_id: string;
  branding_json: BrandingJson;
  terminology_json: Record<string, string>;
  language: string;
  rtl: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const INSTITUTION_SETTINGS_COLUMNS =
  'tenant_id, branding_json, terminology_json, language, rtl, version, created_at, updated_at';

function toBrandingJson(branding: InstitutionSettings['branding']): BrandingJson {
  return {
    name: branding.name,
    logo_url: branding.logoUrl,
    primary_color: branding.primaryColor,
  };
}

function mapInstitutionSettings(row: InstitutionSettingsRow | undefined): InstitutionSettings | null {
  if (row === undefined) {
    return null;
  }
  return {
    institutionId: row.tenant_id,
    branding: {
      name: row.branding_json.name,
      logoUrl: row.branding_json.logo_url,
      primaryColor: row.branding_json.primary_color,
    },
    language: row.language,
    rtl: row.rtl,
    terminology: row.terminology_json,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresInstitutionSettingsRepository implements InstitutionSettingsRepository {
  constructor(private readonly database: TransactionalExecutor) {}

  async create(settings: InstitutionSettings): Promise<void> {
    await this.database.query(
      `INSERT INTO institution_settings (${INSTITUTION_SETTINGS_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        settings.institutionId,
        toBrandingJson(settings.branding),
        settings.terminology,
        settings.language,
        settings.rtl,
        settings.version,
        settings.createdAt,
        settings.updatedAt,
      ],
    );
  }

  async getByInstitutionId(institutionId: string): Promise<InstitutionSettings | null> {
    const result = await this.database.query<InstitutionSettingsRow>(
      `SELECT ${INSTITUTION_SETTINGS_COLUMNS} FROM institution_settings WHERE tenant_id = $1`,
      [institutionId],
    );
    return mapInstitutionSettings(result.rows[0]);
  }

  async update(settings: InstitutionSettings): Promise<void> {
    await this.database.query(
      `UPDATE institution_settings
       SET branding_json = $2, terminology_json = $3, language = $4, rtl = $5, version = $6, updated_at = $7
       WHERE tenant_id = $1`,
      [
        settings.institutionId,
        toBrandingJson(settings.branding),
        settings.terminology,
        settings.language,
        settings.rtl,
        settings.version,
        settings.updatedAt,
      ],
    );
  }
}
