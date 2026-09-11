export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      attachments: {
        Row: {
          file_path: string
          file_type: string | null
          id: string
          label: string | null
          owner_id: string
          owner_table: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          file_path: string
          file_type?: string | null
          id?: string
          label?: string | null
          owner_id: string
          owner_table: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          file_path?: string
          file_type?: string | null
          id?: string
          label?: string | null
          owner_id?: string
          owner_table?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          at: string
          field: string | null
          id: number
          new_value: string | null
          old_value: string | null
          row_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          at?: string
          field?: string | null
          id?: never
          new_value?: string | null
          old_value?: string | null
          row_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          at?: string
          field?: string | null
          id?: never
          new_value?: string | null
          old_value?: string | null
          row_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      chart_of_accounts: {
        Row: {
          account_type: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          account_type: string
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          account_type?: string
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      company: {
        Row: {
          address: string | null
          base_currency: string
          created_at: string
          default_sales_tax_pct: number
          email: string | null
          fiscal_year_start_month: number
          id: string
          legal_name: string
          logo_path: string | null
          ntn: string | null
          phone: string | null
          province: string | null
          strn: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          base_currency?: string
          created_at?: string
          default_sales_tax_pct?: number
          email?: string | null
          fiscal_year_start_month?: number
          id?: string
          legal_name: string
          logo_path?: string | null
          ntn?: string | null
          phone?: string | null
          province?: string | null
          strn?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          base_currency?: string
          created_at?: string
          default_sales_tax_pct?: number
          email?: string | null
          fiscal_year_start_month?: number
          id?: string
          legal_name?: string
          logo_path?: string | null
          ntn?: string | null
          phone?: string | null
          province?: string | null
          strn?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_province_fkey"
            columns: ["province"]
            isOneToOne: false
            referencedRelation: "provinces"
            referencedColumns: ["code"]
          },
        ]
      }
      import_batches: {
        Row: {
          committed_at: string | null
          created_at: string
          entity_type: string
          error_report: Json | null
          id: string
          row_count: number
          source_file_path: string | null
          status: string
          uploaded_by: string | null
        }
        Insert: {
          committed_at?: string | null
          created_at?: string
          entity_type: string
          error_report?: Json | null
          id?: string
          row_count?: number
          source_file_path?: string | null
          status?: string
          uploaded_by?: string | null
        }
        Update: {
          committed_at?: string | null
          created_at?: string
          entity_type?: string
          error_report?: Json | null
          id?: string
          row_count?: number
          source_file_path?: string | null
          status?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      items: {
        Row: {
          base_unit: string
          category: string | null
          created_at: string
          description: string
          hs_code: string | null
          id: string
          is_active: boolean
          is_stocked: boolean
          item_code: string
          spec: string | null
          standard_cost: number
          tax_category: string
          updated_at: string
        }
        Insert: {
          base_unit: string
          category?: string | null
          created_at?: string
          description: string
          hs_code?: string | null
          id?: string
          is_active?: boolean
          is_stocked?: boolean
          item_code: string
          spec?: string | null
          standard_cost?: number
          tax_category?: string
          updated_at?: string
        }
        Update: {
          base_unit?: string
          category?: string | null
          created_at?: string
          description?: string
          hs_code?: string | null
          id?: string
          is_active?: boolean
          is_stocked?: boolean
          item_code?: string
          spec?: string | null
          standard_cost?: number
          tax_category?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_base_unit_fkey"
            columns: ["base_unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
        ]
      }
      journal_entries: {
        Row: {
          created_at: string
          created_by: string | null
          entry_date: string
          entry_no: string
          id: string
          narration: string | null
          source_id: string | null
          source_table: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entry_date?: string
          entry_no: string
          id?: string
          narration?: string | null
          source_id?: string | null
          source_table?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entry_date?: string
          entry_no?: string
          id?: string
          narration?: string | null
          source_id?: string | null
          source_table?: string | null
        }
        Relationships: []
      }
      journal_lines: {
        Row: {
          account_id: string
          credit: number
          debit: number
          id: string
          journal_entry_id: string
          memo: string | null
          party_id: string | null
        }
        Insert: {
          account_id: string
          credit?: number
          debit?: number
          id?: string
          journal_entry_id: string
          memo?: string | null
          party_id?: string | null
        }
        Update: {
          account_id?: string
          credit?: number
          debit?: number
          id?: string
          journal_entry_id?: string
          memo?: string | null
          party_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      login_sessions: {
        Row: {
          device_info: string | null
          id: string
          ip_address: string | null
          login_at: string
          login_method: string
          logout_at: string | null
          user_id: string
        }
        Insert: {
          device_info?: string | null
          id?: string
          ip_address?: string | null
          login_at?: string
          login_method?: string
          logout_at?: string | null
          user_id: string
        }
        Update: {
          device_info?: string | null
          id?: string
          ip_address?: string | null
          login_at?: string
          login_method?: string
          logout_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      numbering_sequences: {
        Row: {
          current_value: number
          doc_type: string
          fy_reset: boolean
          id: string
          label: string
          last_reset_fy: number | null
          padding: number
          prefix: string
          updated_at: string
        }
        Insert: {
          current_value?: number
          doc_type: string
          fy_reset?: boolean
          id?: string
          label: string
          last_reset_fy?: number | null
          padding?: number
          prefix: string
          updated_at?: string
        }
        Update: {
          current_value?: number
          doc_type?: string
          fy_reset?: boolean
          id?: string
          label?: string
          last_reset_fy?: number | null
          padding?: number
          prefix?: string
          updated_at?: string
        }
        Relationships: []
      }
      parties: {
        Row: {
          billing_address: string | null
          cnic: string | null
          created_at: string
          created_by: string | null
          credit_days: number
          credit_limit: number
          id: string
          is_active: boolean
          legal_name: string
          ntn: string | null
          party_type: string
          province: string | null
          row_version: number
          strn: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          billing_address?: string | null
          cnic?: string | null
          created_at?: string
          created_by?: string | null
          credit_days?: number
          credit_limit?: number
          id?: string
          is_active?: boolean
          legal_name: string
          ntn?: string | null
          party_type: string
          province?: string | null
          row_version?: number
          strn?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          billing_address?: string | null
          cnic?: string | null
          created_at?: string
          created_by?: string | null
          credit_days?: number
          credit_limit?: number
          id?: string
          is_active?: boolean
          legal_name?: string
          ntn?: string | null
          party_type?: string
          province?: string | null
          row_version?: number
          strn?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parties_province_fkey"
            columns: ["province"]
            isOneToOne: false
            referencedRelation: "provinces"
            referencedColumns: ["code"]
          },
        ]
      }
      party_contacts: {
        Row: {
          designation: string | null
          email: string | null
          id: string
          is_primary: boolean
          name: string
          party_id: string
          phone: string | null
        }
        Insert: {
          designation?: string | null
          email?: string | null
          id?: string
          is_primary?: boolean
          name: string
          party_id: string
          phone?: string | null
        }
        Update: {
          designation?: string | null
          email?: string | null
          id?: string
          is_primary?: boolean
          name?: string
          party_id?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "party_contacts_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      provinces: {
        Row: {
          code: string
          name: string
        }
        Insert: {
          code: string
          name: string
        }
        Update: {
          code?: string
          name?: string
        }
        Relationships: []
      }
      roles: {
        Row: {
          code: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          code: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          code?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      unit_conversions: {
        Row: {
          factor: number
          from_unit: string
          to_unit: string
        }
        Insert: {
          factor: number
          from_unit: string
          to_unit: string
        }
        Update: {
          factor?: number
          from_unit?: string
          to_unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_conversions_from_unit_fkey"
            columns: ["from_unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "unit_conversions_to_unit_fkey"
            columns: ["to_unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
        ]
      }
      units: {
        Row: {
          code: string
          name: string
        }
        Insert: {
          code: string
          name: string
        }
        Update: {
          code?: string
          name?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          role_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          role_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          address: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      fn_bootstrap_owner: { Args: Record<PropertyKey, never>; Returns: undefined }
      fn_get_next_number: { Args: { p_doc_type: string }; Returns: string }
      fn_log_login: {
        Args: { p_device?: string; p_ip?: string }
        Returns: string
      }
      fn_log_logout: { Args: { p_session_id: string }; Returns: undefined }
      fn_post_journal_entry: {
        Args: {
          p_entry_date: string
          p_lines: Json
          p_narration: string
          p_source_id: string
          p_source_table: string
        }
        Returns: string
      }
      has_role: { Args: { p_code: string }; Returns: boolean }
      is_owner: { Args: Record<PropertyKey, never>; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database["public"]

export type Tables<T extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])> =
  (DefaultSchema["Tables"] & DefaultSchema["Views"])[T] extends { Row: infer R } ? R : never

export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T] extends { Insert: infer I } ? I : never

export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T] extends { Update: infer U } ? U : never
