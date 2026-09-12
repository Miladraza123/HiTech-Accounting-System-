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
      bank_accounts: {
        Row: {
          account_name: string
          account_number: string | null
          bank_name: string | null
          branch: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_name: string
          account_number?: string | null
          bank_name?: string | null
          branch?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_name?: string
          account_number?: string | null
          bank_name?: string | null
          branch?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          updated_at?: string
          updated_by?: string | null
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
          {
            foreignKeyName: "chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "trial_balance"
            referencedColumns: ["account_id"]
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
          period_lock_date: string | null
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
          period_lock_date?: string | null
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
          period_lock_date?: string | null
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
      contra_transfers: {
        Row: {
          amount: number
          cancel_reason: string | null
          created_at: string
          created_by: string | null
          from_bank_account_id: string | null
          from_petty_cash_fund_id: string | null
          from_type: string
          id: string
          journal_entry_id: string | null
          notes: string | null
          status: string
          to_bank_account_id: string | null
          to_petty_cash_fund_id: string | null
          to_type: string
          transfer_date: string
          transfer_no: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          from_bank_account_id?: string | null
          from_petty_cash_fund_id?: string | null
          from_type: string
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          status?: string
          to_bank_account_id?: string | null
          to_petty_cash_fund_id?: string | null
          to_type: string
          transfer_date?: string
          transfer_no: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          from_bank_account_id?: string | null
          from_petty_cash_fund_id?: string | null
          from_type?: string
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          status?: string
          to_bank_account_id?: string | null
          to_petty_cash_fund_id?: string | null
          to_type?: string
          transfer_date?: string
          transfer_no?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contra_transfers_from_bank_account_id_fkey"
            columns: ["from_bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_account_balances"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "contra_transfers_from_bank_account_id_fkey"
            columns: ["from_bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contra_transfers_from_petty_cash_fund_id_fkey"
            columns: ["from_petty_cash_fund_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_fund_balances"
            referencedColumns: ["petty_cash_fund_id"]
          },
          {
            foreignKeyName: "contra_transfers_from_petty_cash_fund_id_fkey"
            columns: ["from_petty_cash_fund_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_funds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contra_transfers_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contra_transfers_to_bank_account_id_fkey"
            columns: ["to_bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_account_balances"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "contra_transfers_to_bank_account_id_fkey"
            columns: ["to_bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contra_transfers_to_petty_cash_fund_id_fkey"
            columns: ["to_petty_cash_fund_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_fund_balances"
            referencedColumns: ["petty_cash_fund_id"]
          },
          {
            foreignKeyName: "contra_transfers_to_petty_cash_fund_id_fkey"
            columns: ["to_petty_cash_fund_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_funds"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_snapshots: {
        Row: {
          bank_balance: number
          cash_in_hand: number
          collections_today: number
          expenses_today: number
          generated_at: string
          generated_by: string | null
          id: string
          payments_today: number
          petty_cash_balance: number
          sales_today: number
          snapshot_date: string
          stock_value: number
          total_ap_outstanding: number
          total_ar_outstanding: number
        }
        Insert: {
          bank_balance?: number
          cash_in_hand?: number
          collections_today?: number
          expenses_today?: number
          generated_at?: string
          generated_by?: string | null
          id?: string
          payments_today?: number
          petty_cash_balance?: number
          sales_today?: number
          snapshot_date: string
          stock_value?: number
          total_ap_outstanding?: number
          total_ar_outstanding?: number
        }
        Update: {
          bank_balance?: number
          cash_in_hand?: number
          collections_today?: number
          expenses_today?: number
          generated_at?: string
          generated_by?: string | null
          id?: string
          payments_today?: number
          petty_cash_balance?: number
          sales_today?: number
          snapshot_date?: string
          stock_value?: number
          total_ap_outstanding?: number
          total_ar_outstanding?: number
        }
        Relationships: []
      }
      delivery_challan_lines: {
        Row: {
          dc_id: string
          delivered_qty: number
          description: string
          id: string
          issue_from_stock: boolean
          item_id: string | null
          sales_order_line_id: string
          sort_order: number
          stock_qty: number | null
          unit: string | null
        }
        Insert: {
          dc_id: string
          delivered_qty: number
          description: string
          id?: string
          issue_from_stock?: boolean
          item_id?: string | null
          sales_order_line_id: string
          sort_order?: number
          stock_qty?: number | null
          unit?: string | null
        }
        Update: {
          dc_id?: string
          delivered_qty?: number
          description?: string
          id?: string
          issue_from_stock?: boolean
          item_id?: string | null
          sales_order_line_id?: string
          sort_order?: number
          stock_qty?: number | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_challan_lines_dc_id_fkey"
            columns: ["dc_id"]
            isOneToOne: false
            referencedRelation: "delivery_challans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_challan_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_challan_lines_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_challan_lines_unit_fkey"
            columns: ["unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
        ]
      }
      delivery_challans: {
        Row: {
          acceptance_status: string
          accepted_at: string | null
          accepted_by_name: string | null
          cancel_reason: string | null
          created_at: string
          created_by: string | null
          dc_no: string
          delivery_date: string
          dispute_note: string | null
          driver_name: string | null
          id: string
          party_id: string
          remarks: string | null
          row_version: number
          sales_order_id: string
          status: string
          updated_at: string
          updated_by: string | null
          vehicle_no: string | null
          warehouse_id: string
        }
        Insert: {
          acceptance_status?: string
          accepted_at?: string | null
          accepted_by_name?: string | null
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          dc_no: string
          delivery_date?: string
          dispute_note?: string | null
          driver_name?: string | null
          id?: string
          party_id: string
          remarks?: string | null
          row_version?: number
          sales_order_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_no?: string | null
          warehouse_id: string
        }
        Update: {
          acceptance_status?: string
          accepted_at?: string | null
          accepted_by_name?: string | null
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          dc_no?: string
          delivery_date?: string
          dispute_note?: string | null
          driver_name?: string | null
          id?: string
          party_id?: string
          remarks?: string | null
          row_version?: number
          sales_order_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_no?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_challans_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_challans_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_challans_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_heads: {
        Row: {
          account_code: string
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_code: string
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_code?: string
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_heads_account_code_fkey"
            columns: ["account_code"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "expense_heads_account_code_fkey"
            columns: ["account_code"]
            isOneToOne: false
            referencedRelation: "trial_balance"
            referencedColumns: ["code"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          bank_account_id: string | null
          cancel_reason: string | null
          created_at: string
          created_by: string | null
          department: string | null
          description: string | null
          expense_date: string
          expense_head_id: string
          expense_no: string
          fuel_litres: number | null
          fuel_rate: number | null
          id: string
          job_id: string | null
          odometer_reading: number | null
          payment_source: string
          petty_cash_fund_id: string | null
          responsible_user_id: string | null
          settlement_status: string
          status: string
          updated_at: string
          updated_by: string | null
          vehicle_id: string | null
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          description?: string | null
          expense_date?: string
          expense_head_id: string
          expense_no: string
          fuel_litres?: number | null
          fuel_rate?: number | null
          id?: string
          job_id?: string | null
          odometer_reading?: number | null
          payment_source: string
          petty_cash_fund_id?: string | null
          responsible_user_id?: string | null
          settlement_status?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string | null
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          description?: string | null
          expense_date?: string
          expense_head_id?: string
          expense_no?: string
          fuel_litres?: number | null
          fuel_rate?: number | null
          id?: string
          job_id?: string | null
          odometer_reading?: number | null
          payment_source?: string
          petty_cash_fund_id?: string | null
          responsible_user_id?: string | null
          settlement_status?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_account_balances"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "expenses_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_expense_head_id_fkey"
            columns: ["expense_head_id"]
            isOneToOne: false
            referencedRelation: "expense_heads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_petty_cash_fund_id_fkey"
            columns: ["petty_cash_fund_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_fund_balances"
            referencedColumns: ["petty_cash_fund_id"]
          },
          {
            foreignKeyName: "expenses_petty_cash_fund_id_fkey"
            columns: ["petty_cash_fund_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_funds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_responsible_user_id_fkey"
            columns: ["responsible_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_responsible_user_id_fkey"
            columns: ["responsible_user_id"]
            isOneToOne: false
            referencedRelation: "responsible_person_expense_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "expenses_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_expense_summary"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "expenses_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
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
      invoice_lines: {
        Row: {
          amount: number | null
          description: string
          id: string
          invoice_id: string
          item_id: string | null
          qty: number
          rate: number
          returned_qty: number
          sales_order_line_id: string
          sort_order: number
          tax_pct: number
          unit: string | null
        }
        Insert: {
          amount?: number | null
          description: string
          id?: string
          invoice_id: string
          item_id?: string | null
          qty: number
          rate?: number
          returned_qty?: number
          sales_order_line_id: string
          sort_order?: number
          tax_pct?: number
          unit?: string | null
        }
        Update: {
          amount?: number | null
          description?: string
          id?: string
          invoice_id?: string
          item_id?: string | null
          qty?: number
          rate?: number
          returned_qty?: number
          sales_order_line_id?: string
          sort_order?: number
          tax_pct?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_outstanding"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_unit_fkey"
            columns: ["unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
        ]
      }
      invoices: {
        Row: {
          cancel_reason: string | null
          created_at: string
          created_by: string | null
          grand_total: number
          id: string
          invoice_date: string
          invoice_no: string
          party_id: string
          row_version: number
          sales_order_id: string
          status: string
          subtotal: number
          tax_total: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          grand_total?: number
          id?: string
          invoice_date?: string
          invoice_no: string
          party_id: string
          row_version?: number
          sales_order_id: string
          status?: string
          subtotal?: number
          tax_total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          grand_total?: number
          id?: string
          invoice_date?: string
          invoice_no?: string
          party_id?: string
          row_version?: number
          sales_order_id?: string
          status?: string
          subtotal?: number
          tax_total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      item_alt_units: {
        Row: {
          created_at: string
          created_by: string | null
          factor: number
          id: string
          is_active: boolean
          item_id: string
          unit: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          factor: number
          id?: string
          is_active?: boolean
          item_id: string
          unit: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          factor?: number
          id?: string
          is_active?: boolean
          item_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_alt_units_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_alt_units_unit_fkey"
            columns: ["unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
        ]
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
      job_cost_ledger: {
        Row: {
          amount: number
          cost_type: string
          created_at: string
          created_by: string | null
          id: string
          item_id: string | null
          job_id: string
          memo: string | null
          qty: number | null
          ref_id: string | null
          ref_table: string | null
        }
        Insert: {
          amount: number
          cost_type: string
          created_at?: string
          created_by?: string | null
          id?: string
          item_id?: string | null
          job_id: string
          memo?: string | null
          qty?: number | null
          ref_id?: string | null
          ref_table?: string | null
        }
        Update: {
          amount?: number
          cost_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          item_id?: string | null
          job_id?: string
          memo?: string | null
          qty?: number | null
          ref_id?: string | null
          ref_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_cost_ledger_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_cost_ledger_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_material_requirements: {
        Row: {
          id: string
          issued_qty: number
          item_id: string
          job_id: string
          required_qty: number
          reserved_qty: number
          returned_qty: number
          source: string
          unit: string | null
        }
        Insert: {
          id?: string
          issued_qty?: number
          item_id: string
          job_id: string
          required_qty: number
          reserved_qty?: number
          returned_qty?: number
          source?: string
          unit?: string | null
        }
        Update: {
          id?: string
          issued_qty?: number
          item_id?: string
          job_id?: string
          required_qty?: number
          reserved_qty?: number
          returned_qty?: number
          source?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_material_requirements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_material_requirements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_material_requirements_unit_fkey"
            columns: ["unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
        ]
      }
      jobs: {
        Row: {
          cancel_reason: string | null
          created_at: string
          created_by: string | null
          description: string
          id: string
          job_no: string
          job_qty: number
          notes: string | null
          product_template_id: string | null
          progress_pct: number
          required_delivery_date: string | null
          responsible_user_id: string | null
          row_version: number
          sales_order_id: string
          sales_order_line_id: string
          start_date: string | null
          status: string
          updated_at: string
          updated_by: string | null
          warehouse_id: string
        }
        Insert: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          job_no: string
          job_qty: number
          notes?: string | null
          product_template_id?: string | null
          progress_pct?: number
          required_delivery_date?: string | null
          responsible_user_id?: string | null
          row_version?: number
          sales_order_id: string
          sales_order_line_id: string
          start_date?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          warehouse_id: string
        }
        Update: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          job_no?: string
          job_qty?: number
          notes?: string | null
          product_template_id?: string | null
          progress_pct?: number
          required_delivery_date?: string | null
          responsible_user_id?: string | null
          row_version?: number
          sales_order_id?: string
          sales_order_line_id?: string
          start_date?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_product_template_id_fkey"
            columns: ["product_template_id"]
            isOneToOne: false
            referencedRelation: "product_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
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
          bank_account_id: string | null
          credit: number
          debit: number
          id: string
          journal_entry_id: string
          memo: string | null
          party_id: string | null
          petty_cash_fund_id: string | null
        }
        Insert: {
          account_id: string
          bank_account_id?: string | null
          credit?: number
          debit?: number
          id?: string
          journal_entry_id: string
          memo?: string | null
          party_id?: string | null
          petty_cash_fund_id?: string | null
        }
        Update: {
          account_id?: string
          bank_account_id?: string | null
          credit?: number
          debit?: number
          id?: string
          journal_entry_id?: string
          memo?: string | null
          party_id?: string | null
          petty_cash_fund_id?: string | null
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
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "trial_balance"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "journal_lines_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_account_balances"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "journal_lines_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
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
          {
            foreignKeyName: "journal_lines_petty_cash_fund_id_fkey"
            columns: ["petty_cash_fund_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_fund_balances"
            referencedColumns: ["petty_cash_fund_id"]
          },
          {
            foreignKeyName: "journal_lines_petty_cash_fund_id_fkey"
            columns: ["petty_cash_fund_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_funds"
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
      payment_allocations: {
        Row: {
          amount: number
          created_at: string
          id: string
          invoice_id: string | null
          payment_id: string
          supplier_bill_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          invoice_id?: string | null
          payment_id: string
          supplier_bill_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          invoice_id?: string | null
          payment_id?: string
          supplier_bill_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_outstanding"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "payment_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_supplier_bill_id_fkey"
            columns: ["supplier_bill_id"]
            isOneToOne: false
            referencedRelation: "supplier_bill_outstanding"
            referencedColumns: ["supplier_bill_id"]
          },
          {
            foreignKeyName: "payment_allocations_supplier_bill_id_fkey"
            columns: ["supplier_bill_id"]
            isOneToOne: false
            referencedRelation: "supplier_bills"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          bank_account_id: string | null
          cancel_reason: string | null
          created_at: string
          created_by: string | null
          direction: string
          id: string
          method: string | null
          notes: string | null
          party_id: string
          payment_date: string
          payment_no: string
          petty_cash_fund_id: string | null
          reference_no: string | null
          row_version: number
          status: string
          unallocated_amount: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          direction: string
          id?: string
          method?: string | null
          notes?: string | null
          party_id: string
          payment_date?: string
          payment_no: string
          petty_cash_fund_id?: string | null
          reference_no?: string | null
          row_version?: number
          status?: string
          unallocated_amount?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string
          id?: string
          method?: string | null
          notes?: string | null
          party_id?: string
          payment_date?: string
          payment_no?: string
          petty_cash_fund_id?: string | null
          reference_no?: string | null
          row_version?: number
          status?: string
          unallocated_amount?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_account_balances"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_petty_cash_fund_id_fkey"
            columns: ["petty_cash_fund_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_fund_balances"
            referencedColumns: ["petty_cash_fund_id"]
          },
          {
            foreignKeyName: "payments_petty_cash_fund_id_fkey"
            columns: ["petty_cash_fund_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_funds"
            referencedColumns: ["id"]
          },
        ]
      }
      petty_cash_funds: {
        Row: {
          created_at: string
          created_by: string | null
          custodian_user_id: string | null
          fund_name: string
          id: string
          is_active: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          custodian_user_id?: string | null
          fund_name: string
          id?: string
          is_active?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          custodian_user_id?: string | null
          fund_name?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_funds_custodian_user_id_fkey"
            columns: ["custodian_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_funds_custodian_user_id_fkey"
            columns: ["custodian_user_id"]
            isOneToOne: false
            referencedRelation: "responsible_person_expense_summary"
            referencedColumns: ["user_id"]
          },
        ]
      }
      product_template_lines: {
        Row: {
          id: string
          item_id: string
          qty_per_unit: number
          sort_order: number
          template_id: string
          unit: string | null
        }
        Insert: {
          id?: string
          item_id: string
          qty_per_unit: number
          sort_order?: number
          template_id: string
          unit?: string | null
        }
        Update: {
          id?: string
          item_id?: string
          qty_per_unit?: number
          sort_order?: number
          template_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_template_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_template_lines_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "product_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_template_lines_unit_fkey"
            columns: ["unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
          },
        ]
      }
      product_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          output_item_id: string | null
          output_unit: string | null
          template_code: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          output_item_id?: string | null
          output_unit?: string | null
          template_code: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          output_item_id?: string | null
          output_unit?: string | null
          template_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_templates_output_item_id_fkey"
            columns: ["output_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_templates_output_unit_fkey"
            columns: ["output_unit"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["code"]
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
      purchase_return_lines: {
        Row: {
          amount: number | null
          description: string
          id: string
          item_id: string | null
          qty: number
          rate: number
          return_id: string
          sort_order: number
          supplier_bill_line_id: string
          tax_pct: number
        }
        Insert: {
          amount?: number | null
          description: string
          id?: string
          item_id?: string | null
          qty: number
          rate?: number
          return_id: string
          sort_order?: number
          supplier_bill_line_id: string
          tax_pct?: number
        }
        Update: {
          amount?: number | null
          description?: string
          id?: string
          item_id?: string | null
          qty?: number
          rate?: number
          return_id?: string
          sort_order?: number
          supplier_bill_line_id?: string
          tax_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_return_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_return_lines_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "purchase_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_return_lines_supplier_bill_line_id_fkey"
            columns: ["supplier_bill_line_id"]
            isOneToOne: false
            referencedRelation: "supplier_bill_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_returns: {
        Row: {
          cancel_reason: string | null
          created_at: string
          created_by: string | null
          grand_total: number
          id: string
          reason: string
          return_date: string
          return_no: string
          status: string
          subtotal: number
          supplier_bill_id: string
          supplier_id: string
          tax_total: number
          updated_at: string
          updated_by: string | null
          warehouse_id: string
        }
        Insert: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          grand_total?: number
          id?: string
          reason: string
          return_date?: string
          return_no: string
          status?: string
          subtotal?: number
          supplier_bill_id: string
          supplier_id: string
          tax_total?: number
          updated_at?: string
          updated_by?: string | null
          warehouse_id: string
        }
        Update: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          grand_total?: number
          id?: string
          reason?: string
          return_date?: string
          return_no?: string
          status?: string
          subtotal?: number
          supplier_bill_id?: string
          supplier_id?: string
          tax_total?: number
          updated_at?: string
          updated_by?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_returns_supplier_bill_id_fkey"
            columns: ["supplier_bill_id"]
            isOneToOne: false
            referencedRelation: "supplier_bill_outstanding"
            referencedColumns: ["supplier_bill_id"]
          },
          {
            foreignKeyName: "purchase_returns_supplier_bill_id_fkey"
            columns: ["supplier_bill_id"]
            isOneToOne: false
            referencedRelation: "supplier_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_returns_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_returns_warehouse_id_fkey"
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
      role_permissions: {
        Row: {
          permission_key: string
          role_codes: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          permission_key: string
          role_codes?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          permission_key?: string
          role_codes?: string[]
          updated_at?: string
          updated_by?: string | null
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
      sales_return_lines: {
        Row: {
          amount: number | null
          description: string
          id: string
          invoice_line_id: string
          item_id: string | null
          qty: number
          rate: number
          return_id: string
          sort_order: number
          stock_value: number
          tax_pct: number
          unit: string | null
        }
        Insert: {
          amount?: number | null
          description: string
          id?: string
          invoice_line_id: string
          item_id?: string | null
          qty: number
          rate?: number
          return_id: string
          sort_order?: number
          stock_value?: number
          tax_pct?: number
          unit?: string | null
        }
        Update: {
          amount?: number | null
          description?: string
          id?: string
          invoice_line_id?: string
          item_id?: string | null
          qty?: number
          rate?: number
          return_id?: string
          sort_order?: number
          stock_value?: number
          tax_pct?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_return_lines_invoice_line_id_fkey"
            columns: ["invoice_line_id"]
            isOneToOne: false
            referencedRelation: "invoice_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_return_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_return_lines_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "sales_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_returns: {
        Row: {
          cancel_reason: string | null
          created_at: string
          created_by: string | null
          grand_total: number
          id: string
          invoice_id: string
          party_id: string
          reason: string
          return_date: string
          return_no: string
          sales_order_id: string
          status: string
          subtotal: number
          tax_total: number
          updated_at: string
          updated_by: string | null
          warehouse_id: string
        }
        Insert: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          grand_total?: number
          id?: string
          invoice_id: string
          party_id: string
          reason: string
          return_date?: string
          return_no: string
          sales_order_id: string
          status?: string
          subtotal?: number
          tax_total?: number
          updated_at?: string
          updated_by?: string | null
          warehouse_id: string
        }
        Update: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          grand_total?: number
          id?: string
          invoice_id?: string
          party_id?: string
          reason?: string
          return_date?: string
          return_no?: string
          sales_order_id?: string
          status?: string
          subtotal?: number
          tax_total?: number
          updated_at?: string
          updated_by?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_returns_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_outstanding"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "sales_returns_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_returns_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_returns_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_returns_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
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
      stock_reservations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          item_id: string
          job_id: string
          reservation_mode: string
          reserved_qty: number
          status: string
          warehouse_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          item_id: string
          job_id: string
          reservation_mode: string
          reserved_qty: number
          status?: string
          warehouse_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          item_id?: string
          job_id?: string
          reservation_mode?: string
          reserved_qty?: number
          status?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_reservations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfer_lines: {
        Row: {
          id: string
          item_id: string
          qty: number
          rate: number
          sort_order: number
          transfer_id: string
        }
        Insert: {
          id?: string
          item_id: string
          qty: number
          rate?: number
          sort_order?: number
          transfer_id: string
        }
        Update: {
          id?: string
          item_id?: string
          qty?: number
          rate?: number
          sort_order?: number
          transfer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          cancel_reason: string | null
          created_at: string
          created_by: string | null
          from_warehouse_id: string
          id: string
          remarks: string | null
          status: string
          to_warehouse_id: string
          transfer_date: string
          transfer_no: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          from_warehouse_id: string
          id?: string
          remarks?: string | null
          status?: string
          to_warehouse_id: string
          transfer_date?: string
          transfer_no: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          from_warehouse_id?: string
          id?: string
          remarks?: string | null
          status?: string
          to_warehouse_id?: string
          transfer_date?: string
          transfer_no?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_from_warehouse_id_fkey"
            columns: ["from_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_to_warehouse_id_fkey"
            columns: ["to_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_bill_lines: {
        Row: {
          amount: number | null
          description: string
          grn_line_id: string | null
          id: string
          item_id: string | null
          qty: number
          rate: number
          returned_qty: number
          sort_order: number
          supplier_bill_id: string
          tax_pct: number
        }
        Insert: {
          amount?: number | null
          description: string
          grn_line_id?: string | null
          id?: string
          item_id?: string | null
          qty: number
          rate?: number
          returned_qty?: number
          sort_order?: number
          supplier_bill_id: string
          tax_pct?: number
        }
        Update: {
          amount?: number | null
          description?: string
          grn_line_id?: string | null
          id?: string
          item_id?: string | null
          qty?: number
          rate?: number
          returned_qty?: number
          sort_order?: number
          supplier_bill_id?: string
          tax_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bill_lines_grn_line_id_fkey"
            columns: ["grn_line_id"]
            isOneToOne: false
            referencedRelation: "grn_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bill_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bill_lines_supplier_bill_id_fkey"
            columns: ["supplier_bill_id"]
            isOneToOne: false
            referencedRelation: "supplier_bill_outstanding"
            referencedColumns: ["supplier_bill_id"]
          },
          {
            foreignKeyName: "supplier_bill_lines_supplier_bill_id_fkey"
            columns: ["supplier_bill_id"]
            isOneToOne: false
            referencedRelation: "supplier_bills"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_bills: {
        Row: {
          bill_date: string
          bill_no: string
          cancel_reason: string | null
          created_at: string
          created_by: string | null
          grand_total: number
          grn_id: string | null
          id: string
          purchase_order_id: string | null
          row_version: number
          status: string
          subtotal: number
          supplier_bill_ref: string | null
          supplier_id: string
          tax_total: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bill_date?: string
          bill_no: string
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          grand_total?: number
          grn_id?: string | null
          id?: string
          purchase_order_id?: string | null
          row_version?: number
          status?: string
          subtotal?: number
          supplier_bill_ref?: string | null
          supplier_id: string
          tax_total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bill_date?: string
          bill_no?: string
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          grand_total?: number
          grn_id?: string | null
          id?: string
          purchase_order_id?: string | null
          row_version?: number
          status?: string
          subtotal?: number
          supplier_bill_ref?: string | null
          supplier_id?: string
          tax_total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bills_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "grns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bills_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bills_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string
          cancel_reason: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          priority: string
          related_id: string | null
          related_table: string | null
          status: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_to: string
          cancel_reason?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          related_id?: string | null
          related_table?: string | null
          status?: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_to?: string
          cancel_reason?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          related_id?: string | null
          related_table?: string | null
          status?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      vehicles: {
        Row: {
          assigned_user_id: string | null
          assignment_date: string | null
          created_at: string
          created_by: string | null
          current_meter_reading: number
          id: string
          make_model: string | null
          opening_meter_reading: number
          registration_no: string | null
          status: string
          updated_at: string
          updated_by: string | null
          vehicle_no: string
          vehicle_type: string | null
        }
        Insert: {
          assigned_user_id?: string | null
          assignment_date?: string | null
          created_at?: string
          created_by?: string | null
          current_meter_reading?: number
          id?: string
          make_model?: string | null
          opening_meter_reading?: number
          registration_no?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_no: string
          vehicle_type?: string | null
        }
        Update: {
          assigned_user_id?: string | null
          assignment_date?: string | null
          created_at?: string
          created_by?: string | null
          current_meter_reading?: number
          id?: string
          make_model?: string | null
          opening_meter_reading?: number
          registration_no?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_no?: string
          vehicle_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "responsible_person_expense_summary"
            referencedColumns: ["user_id"]
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
      bank_account_balances: {
        Row: {
          account_name: string | null
          account_number: string | null
          balance: number | null
          bank_account_id: string | null
          bank_name: string | null
          is_active: boolean | null
        }
        Relationships: []
      }
      cash_in_hand_balance: {
        Row: {
          balance: number | null
        }
        Relationships: []
      }
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
      invoice_outstanding: {
        Row: {
          allocated_amount: number | null
          grand_total: number | null
          invoice_id: string | null
          outstanding_amount: number | null
          party_id: string | null
          returned_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      party_ap_summary: {
        Row: {
          supplier_id: string | null
          total_outstanding: number | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bills_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      party_ar_summary: {
        Row: {
          party_id: string | null
          total_outstanding: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      petty_cash_fund_balances: {
        Row: {
          balance: number | null
          custodian_user_id: string | null
          fund_name: string | null
          is_active: boolean | null
          petty_cash_fund_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_funds_custodian_user_id_fkey"
            columns: ["custodian_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_funds_custodian_user_id_fkey"
            columns: ["custodian_user_id"]
            isOneToOne: false
            referencedRelation: "responsible_person_expense_summary"
            referencedColumns: ["user_id"]
          },
        ]
      }
      reserved_stock: {
        Row: {
          item_id: string | null
          reserved_qty: number | null
          warehouse_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_reservations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      responsible_person_expense_summary: {
        Row: {
          expense_count: number | null
          full_name: string | null
          pending_settlement_count: number | null
          total_expense: number | null
          user_id: string | null
        }
        Relationships: []
      }
      stock_availability: {
        Row: {
          avg_cost: number | null
          free_qty: number | null
          item_id: string | null
          qty_on_hand: number | null
          reserved_qty: number | null
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
      supplier_bill_outstanding: {
        Row: {
          allocated_amount: number | null
          grand_total: number | null
          outstanding_amount: number | null
          returned_amount: number | null
          supplier_bill_id: string | null
          supplier_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bills_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      trial_balance: {
        Row: {
          account_id: string | null
          account_type: string | null
          balance: number | null
          code: string | null
          name: string | null
          total_credit: number | null
          total_debit: number | null
        }
        Relationships: []
      }
      vehicle_expense_summary: {
        Row: {
          assigned_user_id: string | null
          current_meter_reading: number | null
          fuel_expense: number | null
          maintenance_expense: number | null
          make_model: string | null
          opening_meter_reading: number | null
          status: string | null
          total_expense: number | null
          vehicle_id: string | null
          vehicle_no: string | null
          vehicle_type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "responsible_person_expense_summary"
            referencedColumns: ["user_id"]
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
      _fn_next_account_code: {
        Args: { p_parent_code: string }
        Returns: string
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
      _fn_recalc_job_material_status: {
        Args: { p_job_id: string }
        Returns: undefined
      }
      _fn_recalc_po_totals: {
        Args: { p_purchase_order_id: string }
        Returns: undefined
      }
      _fn_recalc_so_totals: {
        Args: { p_sales_order_id: string }
        Returns: undefined
      }
      fn_admin_restore_delete_orphans: {
        Args: { p_rows: Json; p_table_name: string }
        Returns: number
      }
      fn_admin_restore_plan: {
        Args: { p_rows: Json; p_table_name: string }
        Returns: Json
      }
      fn_admin_restore_upsert: {
        Args: { p_mode: string; p_rows: Json; p_table_name: string }
        Returns: Json
      }
      fn_allocate_payment: {
        Args: { p_allocations: Json; p_payment_id: string }
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
      fn_cancel_contra_entry: {
        Args: { p_reason: string; p_transfer_id: string }
        Returns: undefined
      }
      fn_cancel_delivery_challan: {
        Args: { p_dc_id: string; p_reason: string }
        Returns: undefined
      }
      fn_cancel_expense: {
        Args: { p_expense_id: string; p_reason: string }
        Returns: undefined
      }
      fn_cancel_invoice: {
        Args: { p_invoice_id: string; p_reason: string }
        Returns: undefined
      }
      fn_cancel_job: {
        Args: { p_job_id: string; p_reason: string }
        Returns: undefined
      }
      fn_cancel_payment: {
        Args: { p_payment_id: string; p_reason: string }
        Returns: undefined
      }
      fn_cancel_purchase_order: {
        Args: { p_purchase_order_id: string; p_reason: string }
        Returns: undefined
      }
      fn_cancel_purchase_return: { Args: { p_reason: string; p_return_id: string }; Returns: undefined }
      fn_cancel_sales_order: {
        Args: { p_reason: string; p_sales_order_id: string }
        Returns: undefined
      }
      fn_cancel_sales_return: { Args: { p_reason: string; p_return_id: string }; Returns: undefined }
      fn_cancel_stock_transfer: { Args: { p_reason: string; p_transfer_id: string }; Returns: undefined }
      fn_cancel_supplier_bill: {
        Args: { p_reason: string; p_supplier_bill_id: string }
        Returns: undefined
      }
      fn_cancel_task: {
        Args: { p_reason?: string; p_task_id: string }
        Returns: undefined
      }
      fn_complete_task: { Args: { p_task_id: string }; Returns: undefined }
      fn_create_bank_account: {
        Args: {
          p_account_name: string
          p_account_number: string
          p_bank_name: string
          p_branch: string
          p_opening_balance?: number
          p_opening_balance_date?: string
        }
        Returns: string
      }
      fn_create_contra_entry: {
        Args: {
          p_amount: number
          p_from_bank_account_id: string
          p_from_petty_cash_fund_id: string
          p_from_type: string
          p_notes: string
          p_to_bank_account_id: string
          p_to_petty_cash_fund_id: string
          p_to_type: string
          p_transfer_date: string
        }
        Returns: string
      }
      fn_create_delivery_challan: {
        Args: {
          p_delivery_date: string
          p_driver_name: string
          p_lines: Json
          p_remarks: string
          p_sales_order_id: string
          p_vehicle_no: string
          p_warehouse_id: string
        }
        Returns: string
      }
      fn_create_expense: {
        Args: {
          p_amount: number
          p_bank_account_id: string
          p_department: string
          p_description: string
          p_expense_date: string
          p_expense_head_id: string
          p_fuel_litres?: number
          p_fuel_rate?: number
          p_job_id: string
          p_odometer_reading?: number
          p_payment_source: string
          p_petty_cash_fund_id: string
          p_responsible_user_id: string
          p_settlement_status?: string
          p_vehicle_id?: string
        }
        Returns: string
      }
      fn_create_expense_head: {
        Args: { p_code: string; p_name: string }
        Returns: string
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
      fn_create_invoice: {
        Args: {
          p_invoice_date: string
          p_lines: Json
          p_sales_order_id: string
        }
        Returns: string
      }
      fn_create_job: {
        Args: {
          p_description: string
          p_job_qty: number
          p_material_lines: Json
          p_product_template_id: string
          p_required_delivery_date: string
          p_responsible_user_id: string
          p_sales_order_line_id: string
          p_start_date: string
          p_warehouse_id: string
        }
        Returns: string
      }
      fn_create_payment: {
        Args: {
          p_allocations: Json
          p_amount: number
          p_bank_account_id?: string
          p_direction: string
          p_method: string
          p_notes: string
          p_party_id: string
          p_payment_date: string
          p_petty_cash_fund_id?: string
          p_reference_no: string
        }
        Returns: string
      }
      fn_create_petty_cash_fund: {
        Args: {
          p_custodian_user_id: string
          p_fund_name: string
          p_opening_balance?: number
          p_opening_balance_date?: string
        }
        Returns: string
      }
      fn_create_product_template: {
        Args: {
          p_description: string
          p_lines: Json
          p_name: string
          p_output_item_id: string
          p_output_unit: string
          p_template_code: string
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
      fn_create_purchase_return: {
        Args: {
          p_lines: Json
          p_reason: string
          p_return_date: string
          p_supplier_bill_id: string
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
      fn_create_sales_return: {
        Args: {
          p_invoice_id: string
          p_lines: Json
          p_reason: string
          p_return_date: string
          p_warehouse_id: string
        }
        Returns: string
      }
      fn_create_stock_transfer: {
        Args: {
          p_from_warehouse_id: string
          p_lines: Json
          p_remarks: string | null
          p_to_warehouse_id: string
          p_transfer_date: string
        }
        Returns: string
      }
      fn_create_supplier_bill: {
        Args: {
          p_bill_date: string
          p_grn_id: string
          p_supplier_bill_ref: string
        }
        Returns: string
      }
      fn_create_task: {
        Args: {
          p_assigned_to: string
          p_description?: string
          p_due_date?: string
          p_priority?: string
          p_related_id?: string
          p_related_table?: string
          p_title: string
        }
        Returns: string
      }
      fn_generate_daily_snapshot: { Args: { p_date?: string }; Returns: string }
      fn_get_next_number: { Args: { p_doc_type: string }; Returns: string }
      fn_import_opening_stock: {
        Args: {
          p_as_of_date: string
          p_item_code: string
          p_notes: string
          p_qty: number
          p_rate: number
          p_ref_id: string
          p_ref_table: string
          p_warehouse_code: string
        }
        Returns: string
      }
      fn_issue_job_material: {
        Args: { p_item_id: string; p_job_id: string; p_qty: number }
        Returns: undefined
      }
      fn_log_login: {
        Args: { p_device?: string; p_ip?: string }
        Returns: string
      }
      fn_log_logout: { Args: { p_session_id: string }; Returns: undefined }
      fn_mark_job_ready_for_dispatch: {
        Args: { p_job_id: string }
        Returns: undefined
      }
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
      fn_record_dispute: {
        Args: { p_dc_id: string; p_note: string }
        Returns: undefined
      }
      fn_record_pod: {
        Args: { p_accepted_by_name: string; p_dc_id: string; p_note: string }
        Returns: undefined
      }
      fn_reject_stock_adjustment: {
        Args: { p_adjustment_id: string; p_note: string }
        Returns: undefined
      }
      fn_release_job_material: {
        Args: { p_reservation_id: string }
        Returns: undefined
      }
      fn_reopen_task: { Args: { p_task_id: string }; Returns: undefined }
      fn_request_stock_adjustment: {
        Args: {
          p_item_id: string
          p_qty_delta: number
          p_reason: string
          p_warehouse_id: string
        }
        Returns: string
      }
      fn_reserve_job_material: {
        Args: {
          p_item_id: string
          p_job_id: string
          p_qty: number
          p_warehouse_id: string
        }
        Returns: string
      }
      fn_return_job_material: {
        Args: { p_item_id: string; p_job_id: string; p_qty: number }
        Returns: undefined
      }
      fn_set_period_lock: { Args: { p_lock_date: string | null }; Returns: undefined }
      fn_set_query_status: {
        Args: { p_note: string; p_query_id: string; p_status: string }
        Returns: undefined
      }
      fn_set_role_permission: { Args: { p_permission_key: string; p_role_codes: string[] }; Returns: undefined }
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
      fn_update_job_progress: {
        Args: { p_job_id: string; p_note: string; p_progress_pct: number }
        Returns: undefined
      }
      fn_update_task: {
        Args: {
          p_assigned_to: string
          p_description?: string
          p_due_date?: string
          p_priority?: string
          p_task_id: string
          p_title: string
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
