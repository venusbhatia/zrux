// Generated Supabase types placeholder.
//
// Regenerate against a linked project with:
//   pnpm db:types
// which runs: supabase gen types typescript --linked > lib/db/types.ts
//
// Until the project is linked, this hand-written shape keeps the typed client
// compiling and mirrors migration 0001_init.sql. It is intentionally minimal;
// the generated file replaces it wholesale.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Views: Record<string, never>
    CompositeTypes: Record<string, never>
    Tables: {
      context_item: {
        Row: {
          id: string
          user_id: string
          source: string
          type: string
          external_id: string
          title: string | null
          author: string | null
          url: string | null
          source_created_at: string
          source_updated_at: string
          status: string | null
          metadata: Json
          summary: string | null
          summary_embedding: string | null
          raw: Json | null
          is_deleted: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          source: string
          type: string
          external_id: string
          title?: string | null
          author?: string | null
          url?: string | null
          source_created_at: string
          source_updated_at: string
          status?: string | null
          metadata?: Json
          summary?: string | null
          summary_embedding?: string | null
          raw?: Json | null
          is_deleted?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['context_item']['Insert']>
        Relationships: []
      }
      context_chunk: {
        Row: {
          id: string
          item_id: string
          user_id: string
          source: string
          source_created_at: string
          source_updated_at: string
          content: string
          embedding: string | null
        }
        Insert: {
          id?: string
          item_id: string
          user_id: string
          source: string
          source_created_at: string
          source_updated_at: string
          content: string
          embedding?: string | null
        }
        Update: Partial<Database['public']['Tables']['context_chunk']['Insert']>
        Relationships: []
      }
      entity: {
        Row: {
          id: string
          user_id: string
          type: string
          name: string
          email: string | null
          domain: string | null
          aliases: string[]
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          name: string
          email?: string | null
          domain?: string | null
          aliases?: string[]
          metadata?: Json
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['entity']['Insert']>
        Relationships: []
      }
      edge: {
        Row: {
          id: string
          user_id: string
          subject_id: string
          relation: string
          object_id: string
          confidence: number
          source_item: string | null
          occurred_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          subject_id: string
          relation: string
          object_id: string
          confidence?: number
          source_item?: string | null
          occurred_at?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['edge']['Insert']>
        Relationships: []
      }
      sync_state: {
        Row: {
          user_id: string
          source: string
          last_successful_sync_at: string | null
          cursor: string | null
          updated_at: string
        }
        Insert: {
          user_id: string
          source: string
          last_successful_sync_at?: string | null
          cursor?: string | null
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['sync_state']['Insert']>
        Relationships: []
      }
      source_connection: {
        Row: {
          user_id: string
          source: string
          connected_account_id: string
          status: string
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          source: string
          connected_account_id: string
          status?: string
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['source_connection']['Insert']>
        Relationships: []
      }
    }
    Functions: {
      hybrid_search: {
        Args: {
          p_user_id: string
          p_query_embedding: string
          p_query_text: string
          p_sources?: string[] | null
          p_after?: string | null
          p_time_basis?: string
          p_recency_weight?: number
          p_limit?: number
        }
        Returns: {
          chunk_id: string
          item_id: string
          content: string
          score: number
        }[]
      }
      distinct_sources: {
        Args: {
          p_user_id: string
        }
        Returns: {
          source: string
        }[]
      }
    }
    Enums: Record<string, never>
  }
}
