export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_timeline: {
        Row: {
          actor_id: string | null
          at: string
          event_type: string
          id: string
          next_followup_at: string | null
          note: string | null
          owner_id: string
          owner_table: string
        }
        Insert: {
          actor_id?: string | null
          at?: string
          event_type: string
          id?: string
          next_followup_at?: string | null
          note?: string | null
          owner_id: string
          owner_table: string
        }
        Update: {
          actor_id?: string | null
          at?: string
          event_type?: string
          id?: string
          next_followup_at?: string | null
          note?: string | null
          owner_id?: string
          owner_table?: string
        }
        Relationships: []
      }
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
      grn_lines: {
        Row: {
          grn_id: string
          id: string
          item_id: string | null
          ordered_qty: number
          po_line_id: string
          previously_received_qty: number
          rate: number
          short_excess_qty: number | null
          tax_pct: number
          this_receipt_qty: number
          total_received_qty: number | null
          unit: string | null
        }
        Insert: {
          grn_id: string
          id?: string
          item_id?: string | null
          ordered_qty: number
          po_line_id: string
          previously_received_qty?: number
          rate: number
          short_excess_qty?: number | null
          tax_pct?: number
          this_receipt_qty: number
          total_received_qty?: number | null
          unit?: string | null
        }
        Update: {
          grn_id?: string
          id?: string
          item_id?: string | null
          ordered_qty?: number
          po_line_id?: string
          previously_received_qty?: number
          rate?: number
          short_excess_qty?: number | null
          tax_pct?: number
          this_receipt_qty?: number
          total_received_qty?: number | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grn_lines_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "grns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      grns: {
        Row: {
          created_at: string
          created_by: string | null
          grn_no: string
          id: string
          purchase_order_id: string
          received_date: string
          remarks: string | null
          supplier_id: string
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          grn_no: string
          id?: string
          purchase_order_id: string
          received_date?: string
          remarks?: string | null
          supplier_id: string
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          grn_no?: string
          id?: string
          purchase_order_id?: string
          received_date?: string
          remarks?: string | null
          supplier_id?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grns_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grns_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grns_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
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
      purchase_order_lines: {
        Row: {
          amount: number | null
          description: string
          id: string
          item_id: string | null
          ordered_qty: number
          purchase_order_id: string
          rate: number
          received_qty: number
          sort_order: number
          tax_pct: number
          unit: string | null
        }
        Insert: {
          amount?: number | null
          description: string
          id?: string
          item_id?: string | null
          ordered_qty: number
          purchase_order_id: string
          rate: number
          received_qty?: number
          sort_order?: number
          tax_pct?: number
          unit?: string | null
        }
        Update: {
          amount?: number | null
          description?: string
          id?: string
          item_id?: string | null
          ordered_qty?: number
          purchase_order_id?: string
          rate?: number
          received_qty?: number
          sort_order?: number
          tax_pct?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_unit_fkey"
            columns: ["unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          cancel_reason: string | null
          created_at: string
          created_by: string | null
          expected_delivery: string | null
          grand_total: number
          id: string
          linked_sales_order_id: string | null
          po_no: string
          purchase_type: string
          responsible_user_id: string | null
          row_version: number
          status: string
          subtotal: number
          supplier_id: string
          tax_total: number
          updated_at: string
          updated_by: string | null
          warehouse_id: string | null
        }
        Insert: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          expected_delivery?: string | null
          grand_total?: number
          id?: string
          linked_sales_order_id?: string | null
          po_no: string
          purchase_type: string
          responsible_user_id?: string | null
          row_version?: number
          status?: string
          subtotal?: number
          supplier_id: string
          tax_total?: number
          updated_at?: string
          updated_by?: string | null
          warehouse_id?: string | null
        }
        Update: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          expected_delivery?: string | null
          grand_total?: number
          id?: string
          linked_sales_order_id?: string | null
          po_no?: string
          purchase_type?: string
          responsible_user_id?: string | null
          row_version?: number
          status?: string
          subtotal?: number
          supplier_id?: string
          tax_total?: number
          updated_at?: string
          updated_by?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_linked_sales_order_id_fkey"
            columns: ["linked_sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      queries: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          next_followup_at: string | null
          notes: string | null
          party_id: string
          query_date: string
          query_no: string
          requirement: string
          responsible_user_id: string | null
          row_version: number
          source: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          next_followup_at?: string | null
          notes?: string | null
          party_id: string
          query_date?: string
          query_no: string
          requirement: string
          responsible_user_id?: string | null
          row_version?: number
          source?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          next_followup_at?: string | null
          notes?: string | null
          party_id?: string
          query_date?: string
          query_no?: string
          requirement?: string
          responsible_user_id?: string | null
          row_version?: number
          source?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "queries_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queries_source_fkey"
            columns: ["source"]
            isOneToOne: false
            referencedRelation: "query_sources"
            referencedColumns: ["code"]
          },
        ]
      }
      query_sources: {
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
      quotation_lines: {
        Row: {
          amount: number | null
          description: string
          id: string
          item_id: string | null
          qty: number
          rate: number
          revision_id: string
          sort_order: number
          tax_pct: number
          unit: string | null
        }
        Insert: {
          amount?: number | null
          description: string
          id?: string
          item_id?: string | null
          qty: number
          rate: number
          revision_id: string
          sort_order?: number
          tax_pct?: number
          unit?: string | null
        }
        Update: {
          amount?: number | null
          description?: string
          id?: string
          item_id?: string | null
          qty?: number
          rate?: number
          revision_id?: string
          sort_order?: number
          tax_pct?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotation_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_lines_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "quotation_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_lines_unit_fkey"
            columns: ["unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
        ]
      }
      quotation_revisions: {
        Row: {
          created_at: string
          created_by: string | null
          delivery_terms: string | null
          grand_total: number
          id: string
          is_current: boolean
          payment_terms: string | null
          quotation_id: string
          reason: string | null
          rev_no: number
          subtotal: number
          tax_total: number
          terms: string | null
          validity_date: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delivery_terms?: string | null
          grand_total?: number
          id?: string
          is_current?: boolean
          payment_terms?: string | null
          quotation_id: string
          reason?: string | null
          rev_no: number
          subtotal?: number
          tax_total?: number
          terms?: string | null
          validity_date?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delivery_terms?: string | null
          grand_total?: number
          id?: string
          is_current?: boolean
          payment_terms?: string | null
          quotation_id?: string
          reason?: string | null
          rev_no?: number
          subtotal?: number
          tax_total?: number
          terms?: string | null
          validity_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotation_revisions_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          party_id: string
          query_id: string
          quotation_no: string
          responsible_user_id: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          party_id: string
          query_id: string
          quotation_no: string
          responsible_user_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          party_id?: string
          query_id?: string
          quotation_no?: string
          responsible_user_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotations_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "queries"
            referencedColumns: ["id"]
          },
        ]
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
      sales_order_lines: {
        Row: {
          amount: number | null
          delivered_qty: number
          description: string
          id: string
          invoiced_qty: number
          item_id: string | null
          ordered_qty: number
          rate: number
          sales_order_id: string
          sort_order: number
          tax_pct: number
          unit: string | null
        }
        Insert: {
          amount?: number | null
          delivered_qty?: number
          description: string
          id?: string
          invoiced_qty?: number
          item_id?: string | null
          ordered_qty: number
          rate: number
          sales_order_id: string
          sort_order?: number
          tax_pct?: number
          unit?: string | null
        }
        Update: {
          amount?: number | null
          delivered_qty?: number
          description?: string
          id?: string
          invoiced_qty?: number
          item_id?: string | null
          ordered_qty?: number
          rate?: number
          sales_order_id?: string
          sort_order?: number
          tax_pct?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_lines_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_lines_unit_fkey"
            columns: ["unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
        ]
      }
      sales_order_revisions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          reason: string
          rev_no: number
          sales_order_id: string
          snapshot: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          reason: string
          rev_no: number
          sales_order_id: string
          snapshot: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string
          rev_no?: number
          sales_order_id?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_revisions_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_orders: {
        Row: {
          business_line: string
          cancel_reason: string | null
          client_po_number: string
          created_at: string
          created_by: string | null
          delivery_schedule: string | null
          grand_total: number
          id: string
          party_id: string
          payment_terms: string | null
          po_date: string
          query_id: string
          quotation_id: string
          responsible_user_id: string | null
          row_version: number
          so_no: string
          status: string
          subtotal: number
          tax_total: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          business_line: string
          cancel_reason?: string | null
          client_po_number: string
          created_at?: string
          created_by?: string | null
          delivery_schedule?: string | null
          grand_total?: number
          id?: string
          party_id: string
          payment_terms?: string | null
          po_date?: string
          query_id: string
          quotation_id: string
          responsible_user_id?: string | null
          row_version?: number
          so_no: string
          status?: string
          subtotal?: number
          tax_total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          business_line?: string
          cancel_reason?: string | null
          client_po_number?: string
          created_at?: string
          created_by?: string | null
          delivery_schedule?: string | null
          grand_total?: number
          id?: string
          party_id?: string
          payment_terms?: string | null
          po_date?: string
          query_id?: string
          quotation_id?: string
          responsible_user_id?: string | null
          row_version?: number
          so_no?: string
          status?: string
          subtotal?: number
          tax_total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_orders_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "queries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          item_id: string
          qty_delta: number
          reason: string
          requested_at: string
          requested_by: string | null
          status: string
          warehouse_id: string
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          item_id: string
          qty_delta: number
          reason: string
          requested_at?: string
          requested_by?: string | null
          status?: string
          warehouse_id: string
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          item_id?: string
          qty_delta?: number
          reason?: string
          requested_at?: string
          requested_by?: string | null
          status?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_ledger: {
        Row: {
          avg_cost: number
          created_at: string
          created_by: string | null
          id: string
          item_id: string
          notes: string | null
          qty: number
          rate: number
          ref_id: string | null
          ref_table: string | null
          running_balance: number
          txn_type: string
          warehouse_id: string
        }
        Insert: {
          avg_cost?: number
          created_at?: string
          created_by?: string | null
          id?: string
          item_id: string
          notes?: string | null
          qty: number
          rate?: number
          ref_id?: string | null
          ref_table?: string | null
          running_balance: number
          txn_type: string
          warehouse_id: string
        }
        Update: {
          avg_cost?: number
          created_at?: string
          created_by?: string | null
          id?: string
          item_id?: string
          notes?: string | null
          qty?: number
          rate?: number
          ref_id?: string | null
          ref_table?: string | null
          running_balance?: number
          txn_type?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_ledger_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
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
      current_stock: {
        Row: {
          as_of: string | null
          avg_cost: number | null
          item_id: string | null
          qty_on_hand: number | null
          stock_value: number | null
          warehouse_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_ledger_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _fn_insert_quotation_lines: {
        Args: { p_lines: Json; p_revision_id: string }
        Returns: {
          grand_total: number
          subtotal: number
          tax_total: number
        }[]
      }
      _fn_post_journal_entry_core: {
        Args: {
          p_entry_date: string
          p_lines: Json
          p_narration: string
          p_source_id: string
          p_source_table: string
        }
        Returns: string
      }
      _fn_post_stock_ledger: {
        Args: {
          p_item_id: string
          p_notes: string
          p_qty: number
          p_rate: number
          p_ref_id: string
          p_ref_table: string
          p_txn_type: string
          p_warehouse_id: string
        }
        Returns: string
      }
      _fn_recalc_po_totals: {
        Args: { p_purchase_order_id: string }
        Returns: undefined
      }
      _fn_recalc_so_totals: {
        Args: { p_sales_order_id: string }
        Returns: undefined
      }
      fn_amend_sales_order: {
        Args: {
          p_client_po_number: string
          p_delivery_schedule: string
          p_lines: Json
          p_payment_terms: string
          p_po_date: string
          p_reason: string
          p_sales_order_id: string
        }
        Returns: string
      }
      fn_approve_stock_adjustment: {
        Args: { p_adjustment_id: string }
        Returns: undefined
      }
      fn_bootstrap_owner: { Args: never; Returns: undefined }
      fn_cancel_purchase_order: {
        Args: { p_purchase_order_id: string; p_reason: string }
        Returns: undefined
      }
      fn_cancel_sales_order: {
        Args: { p_reason: string; p_sales_order_id: string }
        Returns: undefined
      }
      fn_create_grn: {
        Args: {
          p_lines: Json
          p_purchase_order_id: string
          p_received_date: string
          p_remarks: string
          p_supplier_id: string
          p_warehouse_id: string
        }
        Returns: string
      }
      fn_create_purchase_order: {
        Args: {
          p_expected_delivery: string
          p_lines: Json
          p_linked_sales_order_id: string
          p_purchase_type: string
          p_supplier_id: string
          p_warehouse_id: string
        }
        Returns: string
      }
      fn_create_quotation: {
        Args: {
          p_delivery_terms: string
          p_lines: Json
          p_payment_terms: string
          p_query_id: string
          p_terms: string
          p_validity_date: string
        }
        Returns: string
      }
      fn_create_quotation_revision: {
        Args: {
          p_delivery_terms: string
          p_lines: Json
          p_payment_terms: string
          p_quotation_id: string
          p_reason: string
          p_terms: string
          p_validity_date: string
        }
        Returns: string
      }
      fn_create_sales_order: {
        Args: {
          p_business_line: string
          p_client_po_number: string
          p_confirm_duplicate?: boolean
          p_delivery_schedule: string
          p_lines: Json
          p_payment_terms: string
          p_po_date: string
          p_quotation_id: string
        }
        Returns: string
      }
      fn_get_next_number: { Args: { p_doc_type: string }; Returns: string }
      fn_log_login: {
        Args: { p_device?: string; p_ip?: string }
        Returns: string
      }
      fn_log_logout: { Args: { p_session_id: string }; Returns: undefined }
      fn_mark_quotation_sent: {
        Args: { p_quotation_id: string }
        Returns: undefined
      }
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
      fn_reject_stock_adjustment: {
        Args: { p_adjustment_id: string; p_note: string }
        Returns: undefined
      }
      fn_request_stock_adjustment: {
        Args: {
          p_item_id: string
          p_qty_delta: number
          p_reason: string
          p_warehouse_id: string
        }
        Returns: string
      }
      fn_set_query_status: {
        Args: { p_note: string; p_query_id: string; p_status: string }
        Returns: undefined
      }
      fn_update_draft_quotation: {
        Args: {
          p_delivery_terms: string
          p_lines: Json
          p_payment_terms: string
          p_quotation_id: string
          p_terms: string
          p_validity_date: string
        }
        Returns: undefined
      }
      has_role: { Args: { p_code: string }; Returns: boolean }
      is_owner: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

