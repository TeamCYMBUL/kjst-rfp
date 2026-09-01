-- ============================================================================
-- KJST RFP Platform — database schema snapshot (generated from live database)
-- Reviewable record of tables, Row-Level Security, and security-definer functions.
-- Regenerate after any schema/policy change. See README.md in this folder.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — TABLES (public schema)
-- ============================================================================

TABLE activity_events (id uuid, organization_id uuid, client_id uuid, trip_id uuid, actor_id uuid, event_type text, detail jsonb, at timestamp with time zone)
TABLE app_config (key text, value text, updated_at timestamp with time zone)
TABLE backup_status (id integer, last_success_at timestamp with time zone, last_detail text, last_alert_at timestamp with time zone, updated_at timestamp with time zone)
TABLE client_assignments (id uuid, staff_user_id uuid, client_id uuid, assigned_by uuid, created_at timestamp with time zone)
TABLE client_concession_items (id uuid, client_id uuid, sort_order integer, section text, label text, answer_type text, requested_value text, allow_comment boolean, archived boolean, created_at timestamp with time zone)
TABLE clients (id uuid, organization_id uuid, team_name text, legal_entity text, league text, primary_contact_name text, primary_contact_title text, primary_contact_address text, primary_contact_phone text, primary_contact_email text, season text, default_terms jsonb, created_at timestamp with time zone, logo_url text, assigned_to uuid, always_cc_enabled boolean, always_cc_name text, always_cc_email text, sample_menus jsonb, progress_steps jsonb, grid_columns jsonb, fnb_headcount integer, grid_layout jsonb)
TABLE concession_answers (id uuid, response_id uuid, concession_item_id uuid, answer_yes_no boolean, answer_value text, comment text, created_at timestamp with time zone)
TABLE concession_items (id uuid, organization_id uuid, sort_order integer, section text, label text, answer_type text, requested_value text, allow_comment boolean, created_at timestamp with time zone, archived boolean, client_id uuid, optional boolean)
TABLE contract_check_rules (id uuid, rule_text text, active boolean, sort_order integer, created_by text, created_at timestamp with time zone, updated_at timestamp with time zone)
TABLE contracts (id uuid, invitation_id uuid, trip_id uuid, client_id uuid, token text, status text, file_path text, file_name text, uploaded_at timestamp with time zone, signed_file_path text, signed_file_name text, signed_at timestamp with time zone, analysis jsonb, analyzed_at timestamp with time zone, staff_notes text, created_at timestamp with time zone, updated_at timestamp with time zone)
TABLE email_cc_contacts (id uuid, organization_id uuid, scope text, brand text, hotel_id uuid, name text, email text, created_at timestamp with time zone)
TABLE error_logs (id bigint, created_at timestamp with time zone, kind text, message text, stack text, component_stack text, url text, user_agent text, app_version text, context jsonb, seen boolean)
TABLE grid_versions (id uuid, trip_id uuid, version_label text, snapshot jsonb, created_at timestamp with time zone, created_by uuid)
TABLE hotel_contacts (id uuid, hotel_id uuid, contact_name text, contact_email text, contact_phone text, created_at timestamp with time zone)
TABLE hotel_email_contacts (id uuid, organization_id uuid, hotel_brand_pattern text, applies_to_leagues text[], contact_name text, contact_email text, cc_on_invite boolean, cc_on_decline boolean, sort_order integer, created_at timestamp with time zone)
TABLE hotel_notes (id uuid, hotel_id uuid, note text, created_at timestamp with time zone, created_by uuid)
TABLE hotels (id uuid, name text, chain text, city text, contact_name text, contact_email text, contact_phone text, notes text, created_at timestamp with time zone, logo_url text, brand_cc_name text, brand_cc_email text, league text, brand text, created_by uuid, created_by_name text)
TABLE organizations (id uuid, name text, iata_number text, created_at timestamp with time zone, contact_name text, contact_title text, contact_address text, contact_phone text, contact_email text, season_label text, invitation_email_template text)
TABLE profiles (id uuid, organization_id uuid, full_name text, email text, role text, created_at timestamp with time zone)
TABLE rfp_invitations (id uuid, trip_id uuid, hotel_name text, hotel_contact_name text, hotel_contact_email text, token text, status text, sent_at timestamp with time zone, opened_at timestamp with time zone, submitted_at timestamp with time zone, created_at timestamp with time zone, staff_notes text, decline_reason text, decline_notes text, declined_at timestamp with time zone, visit1_declined boolean, visit1_decline_reason text, visit1_decline_notes text, visit1_declined_at timestamp with time zone, visit2_declined boolean, visit2_decline_reason text, visit2_decline_notes text, visit2_declined_at timestamp with time zone, printed_at timestamp with time zone, reopened_at timestamp with time zone, awarded_stay1 boolean, awarded_stay2 boolean, visit_scope text, original_bid jsonb, revoked_at timestamp with time zone)
TABLE rfp_responses (id uuid, invitation_id uuid, completed_by_name text, completed_date date, best_king_rate numeric, king_rate_notes text, current_selling_rate text, best_suite_rate numeric, occupancy_tax text, meeting_space_notes text, general_comments text, guarantees_in_season_tournament boolean, guarantees_postseason boolean, distance_to_arena text, standard_checkin_time text, baggage_fee_per_bag numeric, room_service_24h boolean, room_service_hours text, created_at timestamp with time zone, stay2_king_rate numeric, stay2_suite_rate numeric, stay2_selling_rate text, est_cost_stay1 numeric, est_cost_stay2 numeric, scenario_rates jsonb, meeting_space_type text, meeting_space_count integer, resort_fee text, scenario_availability jsonb, menu_attachments jsonb)
TABLE staff_profiles (id uuid, display_name text, role text, created_at timestamp with time zone, title text, phone text)
TABLE tickets (id uuid, organization_id uuid, created_by uuid, created_by_name text, created_by_email text, title text, description text, page_url text, status text, created_at timestamp with time zone, resolved_at timestamp with time zone, attachments jsonb)
TABLE trip_concession_items (id uuid, trip_id uuid, source_item_id uuid, sort_order integer, section text, label text, answer_type text, requested_value text, allow_comment boolean, created_at timestamp with time zone, optional boolean)
TABLE trips (id uuid, client_id uuid, city text, opponent_label text, arrival_date date, departure_date date, nights integer, game_date date, game_time text, king_rooms_requested integer, suites_requested integer, total_rooms_requested integer, in_season_tournament_window text, postseason_window text, postseason_rooms_text text, status text, response_deadline date, created_at timestamp with time zone, stay2_arrival_date date, stay2_departure_date date, stay2_game_date date, stay2_game_time text, night_scenarios integer[], postseason_type text, date_scenarios jsonb, double_rooms_requested integer, game_dates jsonb, stay2_game_dates jsonb, fnb_plan jsonb, progress_steps jsonb, cancelled boolean, cancelled_at timestamp with time zone)
TABLE uptime_checks (id bigint, checked_at timestamp with time zone, url text, ok boolean, status_code integer, latency_ms integer, error text)
TABLE uptime_state (id integer, is_down boolean, since timestamp with time zone, last_alert_at timestamp with time zone)


-- ============================================================================
-- SECTION 2 — ROW-LEVEL SECURITY (all 27 tables enabled; 61 policies)
-- ============================================================================

alter table public.activity_events enable row level security;
alter table public.app_config enable row level security;
alter table public.backup_status enable row level security;
alter table public.client_assignments enable row level security;
alter table public.client_concession_items enable row level security;
alter table public.clients enable row level security;
alter table public.concession_answers enable row level security;
alter table public.concession_items enable row level security;
alter table public.contract_check_rules enable row level security;
alter table public.contracts enable row level security;
alter table public.email_cc_contacts enable row level security;
alter table public.error_logs enable row level security;
alter table public.grid_versions enable row level security;
alter table public.hotel_contacts enable row level security;
alter table public.hotel_email_contacts enable row level security;
alter table public.hotel_notes enable row level security;
alter table public.hotels enable row level security;
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.rfp_invitations enable row level security;
alter table public.rfp_responses enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.tickets enable row level security;
alter table public.trip_concession_items enable row level security;
alter table public.trips enable row level security;
alter table public.uptime_checks enable row level security;
alter table public.uptime_state enable row level security;

-- activity_events
create policy "activity_events member insert" on public.activity_events as permissive for insert to public
  with check ((organization_id = current_org_id()));
create policy "activity_events timeline admin read" on public.activity_events as permissive for select to public
  using ((is_timeline_admin() AND (organization_id = current_org_id())));

-- app_config
create policy app_config_read on public.app_config as permissive for select to authenticated
  using (true);
create policy app_config_write on public.app_config as permissive for all to authenticated
  using (is_timeline_admin())
  with check (is_timeline_admin());

-- backup_status
create policy "staff read backup status" on public.backup_status as permissive for select to authenticated
  using (true);

-- client_assignments
create policy assignments_admin_all on public.client_assignments as permissive for all to authenticated
  using (is_admin())
  with check (is_admin());
create policy assignments_self_select on public.client_assignments as permissive for select to authenticated
  using ((staff_user_id = auth.uid()));
create policy client_assignments_select on public.client_assignments as permissive for select to public
  using ((EXISTS ( SELECT 1 FROM clients c
    WHERE ((c.id = client_assignments.client_id) AND (c.organization_id = current_org_id())))));
create policy client_assignments_write on public.client_assignments as permissive for all to public
  using (((EXISTS ( SELECT 1 FROM clients c
    WHERE ((c.id = client_assignments.client_id) AND (c.organization_id = current_org_id())))) AND is_admin()))
  with check (((EXISTS ( SELECT 1 FROM clients c
    WHERE ((c.id = client_assignments.client_id) AND (c.organization_id = current_org_id())))) AND is_admin()));

-- client_concession_items
create policy client_concession_items_org on public.client_concession_items as permissive for all to public
  using ((EXISTS ( SELECT 1 FROM clients c
    WHERE ((c.id = client_concession_items.client_id) AND (c.organization_id = current_org_id())))))
  with check ((EXISTS ( SELECT 1 FROM clients c
    WHERE ((c.id = client_concession_items.client_id) AND (c.organization_id = current_org_id())))));

-- clients
create policy clients_admin_write on public.clients as permissive for all to authenticated
  using (((organization_id = current_org_id()) AND is_admin()))
  with check (((organization_id = current_org_id()) AND is_admin()));
create policy clients_delete on public.clients as permissive for delete to public
  using (((organization_id = current_org_id()) AND is_admin()));
create policy clients_insert on public.clients as permissive for insert to public
  with check (((organization_id = current_org_id()) AND is_admin()));
create policy clients_select on public.clients as permissive for select to public
  using ((organization_id = current_org_id()));
create policy clients_update on public.clients as permissive for update to public
  using (((organization_id = current_org_id()) AND (is_admin() OR is_assigned_to_client(id))))
  with check (((organization_id = current_org_id()) AND (is_admin() OR is_assigned_to_client(id))));

-- concession_answers
create policy concession_answers_org on public.concession_answers as permissive for all to public
  using ((EXISTS ( SELECT 1 FROM (((rfp_responses r
     JOIN rfp_invitations i ON ((i.id = r.invitation_id)))
     JOIN trips t ON ((t.id = i.trip_id)))
     JOIN clients c ON ((c.id = t.client_id)))
  WHERE ((r.id = concession_answers.response_id) AND (c.organization_id = current_org_id())))))
  with check ((EXISTS ( SELECT 1 FROM (((rfp_responses r
     JOIN rfp_invitations i ON ((i.id = r.invitation_id)))
     JOIN trips t ON ((t.id = i.trip_id)))
     JOIN clients c ON ((c.id = t.client_id)))
  WHERE ((r.id = concession_answers.response_id) AND (c.organization_id = current_org_id())))));

-- concession_items
create policy concession_items_all on public.concession_items as permissive for all to authenticated
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));

-- contract_check_rules (edit limited to owner + Catherine + Anabel)
create policy contract_rules_editors_delete on public.contract_check_rules as permissive for delete to authenticated
  using (((auth.jwt() ->> 'email'::text) = ANY (ARRAY['info@cymbul.co'::text, 'cgibson@kjsportstravel.com'::text, 'acabrera@kjsportstravel.com'::text])));
create policy contract_rules_editors_insert on public.contract_check_rules as permissive for insert to authenticated
  with check (((auth.jwt() ->> 'email'::text) = ANY (ARRAY['info@cymbul.co'::text, 'cgibson@kjsportstravel.com'::text, 'acabrera@kjsportstravel.com'::text])));
create policy contract_rules_editors_update on public.contract_check_rules as permissive for update to authenticated
  using (((auth.jwt() ->> 'email'::text) = ANY (ARRAY['info@cymbul.co'::text, 'cgibson@kjsportstravel.com'::text, 'acabrera@kjsportstravel.com'::text])))
  with check (((auth.jwt() ->> 'email'::text) = ANY (ARRAY['info@cymbul.co'::text, 'cgibson@kjsportstravel.com'::text, 'acabrera@kjsportstravel.com'::text])));
create policy contract_rules_read on public.contract_check_rules as permissive for select to authenticated
  using (true);

-- contracts
create policy "contracts staff read" on public.contracts as permissive for select to authenticated
  using (true);
create policy "contracts staff write" on public.contracts as permissive for all to authenticated
  using (true)
  with check (true);

-- email_cc_contacts
create policy "email_cc read" on public.email_cc_contacts as permissive for select to public
  using ((organization_id = current_org_id()));
create policy "email_cc write" on public.email_cc_contacts as permissive for all to public
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));

-- error_logs
create policy "staff read error logs" on public.error_logs as permissive for select to authenticated
  using (true);

-- grid_versions
create policy grid_versions_org on public.grid_versions as permissive for all to public
  using ((EXISTS ( SELECT 1 FROM (trips t JOIN clients c ON ((c.id = t.client_id)))
  WHERE ((t.id = grid_versions.trip_id) AND (c.organization_id = current_org_id())))))
  with check ((EXISTS ( SELECT 1 FROM (trips t JOIN clients c ON ((c.id = t.client_id)))
  WHERE ((t.id = grid_versions.trip_id) AND (c.organization_id = current_org_id())))));

-- hotel_contacts
create policy "hotel_contacts staff delete" on public.hotel_contacts as permissive for delete to authenticated
  using (true);
create policy "hotel_contacts staff insert" on public.hotel_contacts as permissive for insert to authenticated
  with check (true);
create policy "hotel_contacts staff read" on public.hotel_contacts as permissive for select to authenticated
  using (true);
create policy "hotel_contacts staff update" on public.hotel_contacts as permissive for update to authenticated
  using (true)
  with check (true);

-- hotel_email_contacts
create policy hotel_email_contacts_org on public.hotel_email_contacts as permissive for all to public
  using ((organization_id = current_org_id()))
  with check ((organization_id = current_org_id()));

-- hotel_notes
create policy "Authenticated users can delete hotel_notes" on public.hotel_notes as permissive for delete to public
  using ((auth.role() = 'authenticated'::text));
create policy "Authenticated users can insert hotel_notes" on public.hotel_notes as permissive for insert to public
  with check ((auth.role() = 'authenticated'::text));
create policy "Authenticated users can read hotel_notes" on public.hotel_notes as permissive for select to public
  using ((auth.role() = 'authenticated'::text));

-- hotels
create policy "Authenticated users can delete hotels" on public.hotels as permissive for delete to authenticated
  using (true);
create policy "Authenticated users can insert hotels" on public.hotels as permissive for insert to authenticated
  with check (true);
create policy "Authenticated users can read hotels" on public.hotels as permissive for select to authenticated
  using (true);
create policy "Authenticated users can update hotels" on public.hotels as permissive for update to authenticated
  using (true);

-- organizations
create policy org_select on public.organizations as permissive for select to authenticated
  using ((id = current_org_id()));
create policy org_update on public.organizations as permissive for update to authenticated
  using ((id = current_org_id()))
  with check ((id = current_org_id()));

-- profiles
create policy profiles_select on public.profiles as permissive for select to public
  using (((id = auth.uid()) OR (organization_id = current_org_id())));
create policy profiles_update_self on public.profiles as permissive for update to authenticated
  using ((id = auth.uid()))
  with check (((id = auth.uid()) AND (organization_id = current_org_id())));

-- rfp_invitations
create policy rfp_invitations_delete on public.rfp_invitations as permissive for delete to public
  using ((EXISTS ( SELECT 1 FROM (trips t JOIN clients c ON ((c.id = t.client_id)))
  WHERE ((t.id = rfp_invitations.trip_id) AND (c.organization_id = current_org_id()) AND (is_admin() OR is_assigned_to_client(c.id))))));
create policy rfp_invitations_insert on public.rfp_invitations as permissive for insert to public
  with check ((EXISTS ( SELECT 1 FROM (trips t JOIN clients c ON ((c.id = t.client_id)))
  WHERE ((t.id = rfp_invitations.trip_id) AND (c.organization_id = current_org_id()) AND (is_admin() OR is_assigned_to_client(c.id))))));
create policy rfp_invitations_org on public.rfp_invitations as permissive for select to public
  using ((EXISTS ( SELECT 1 FROM (trips t JOIN clients c ON ((c.id = t.client_id)))
  WHERE ((t.id = rfp_invitations.trip_id) AND (c.organization_id = current_org_id())))));
create policy rfp_invitations_update on public.rfp_invitations as permissive for update to public
  using ((EXISTS ( SELECT 1 FROM (trips t JOIN clients c ON ((c.id = t.client_id)))
  WHERE ((t.id = rfp_invitations.trip_id) AND (c.organization_id = current_org_id()) AND (is_admin() OR is_assigned_to_client(c.id))))));

-- rfp_responses
create policy rfp_responses_org on public.rfp_responses as permissive for all to public
  using ((EXISTS ( SELECT 1 FROM ((rfp_invitations i JOIN trips t ON ((t.id = i.trip_id)))
     JOIN clients c ON ((c.id = t.client_id)))
  WHERE ((i.id = rfp_responses.invitation_id) AND (c.organization_id = current_org_id())))))
  with check ((EXISTS ( SELECT 1 FROM ((rfp_invitations i JOIN trips t ON ((t.id = i.trip_id)))
     JOIN clients c ON ((c.id = t.client_id)))
  WHERE ((i.id = rfp_responses.invitation_id) AND (c.organization_id = current_org_id())))));

-- staff_profiles
create policy staff_profiles_admin_write on public.staff_profiles as permissive for all to authenticated
  using (is_admin())
  with check (is_admin());
create policy staff_profiles_select on public.staff_profiles as permissive for select to authenticated
  using (true);

-- tickets
create policy tickets_delete on public.tickets as permissive for delete to public
  using (((organization_id = current_org_id()) AND is_admin()));
create policy tickets_insert on public.tickets as permissive for insert to public
  with check (((organization_id = current_org_id()) AND (created_by = auth.uid())));
create policy tickets_select on public.tickets as permissive for select to public
  using ((organization_id = current_org_id()));
create policy tickets_update on public.tickets as permissive for update to public
  using (((organization_id = current_org_id()) AND is_admin()))
  with check (((organization_id = current_org_id()) AND is_admin()));

-- trip_concession_items
create policy trip_concession_items_org on public.trip_concession_items as permissive for all to public
  using ((EXISTS ( SELECT 1 FROM (trips t JOIN clients c ON ((c.id = t.client_id)))
  WHERE ((t.id = trip_concession_items.trip_id) AND (c.organization_id = current_org_id())))))
  with check ((EXISTS ( SELECT 1 FROM (trips t JOIN clients c ON ((c.id = t.client_id)))
  WHERE ((t.id = trip_concession_items.trip_id) AND (c.organization_id = current_org_id())))));

-- trips
create policy trips_delete on public.trips as permissive for delete to public
  using ((EXISTS ( SELECT 1 FROM clients c
  WHERE ((c.id = trips.client_id) AND (c.organization_id = current_org_id()) AND (is_admin() OR is_assigned_to_client(c.id))))));
create policy trips_insert on public.trips as permissive for insert to public
  with check ((EXISTS ( SELECT 1 FROM clients c
  WHERE ((c.id = trips.client_id) AND (c.organization_id = current_org_id()) AND (is_admin() OR is_assigned_to_client(c.id))))));
create policy trips_org on public.trips as permissive for select to public
  using ((EXISTS ( SELECT 1 FROM clients c
  WHERE ((c.id = trips.client_id) AND (c.organization_id = current_org_id())))));
create policy trips_update on public.trips as permissive for update to public
  using ((EXISTS ( SELECT 1 FROM clients c
  WHERE ((c.id = trips.client_id) AND (c.organization_id = current_org_id()) AND (is_admin() OR is_assigned_to_client(c.id))))));

-- uptime_checks / uptime_state
create policy "staff read uptime checks" on public.uptime_checks as permissive for select to authenticated
  using (true);
create policy "staff read uptime state" on public.uptime_state as permissive for select to authenticated
  using (true);


-- ============================================================================
-- SECTION 3 — SECURITY DEFINER FUNCTIONS (the trust anchors RLS depends on)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.current_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select organization_id from public.profiles where id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role = 'admin' FROM public.profiles WHERE id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.is_assigned_to_client(p_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.client_assignments
    WHERE staff_user_id = auth.uid()
      AND client_id = p_client_id
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_timeline_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and lower(email) in (
        'info@cymbul.co',
        'cgibson@kjsportstravel.com',
        'acabrera@kjsportstravel.com'
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_viewer()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'viewer'
  )
$function$;

-- handle_new_user(): trigger on auth.users; seeds profiles + staff_profiles into
--   the KJ Sports Travel organization on signup.
-- get_lifecycle_metrics(p_client_id) / get_lifecycle_timeline(p_client_id):
--   timeline-admin-gated reporting RPCs; org-scoped, return nothing to non-admins.
-- mark_proposal_sent(p_trip_id, p_client_id): idempotent activity-event logger.
-- monitoring_scoreboard(): owner/service-role-gated platform health (see /status).
-- snapshot_concession_items_for_trip(p_trip_id) + trigger_snapshot_on_invite():
--   freeze the concession template onto a trip when its first hotel is invited.
-- Full bodies of the above are in the live database; the security-critical gates
-- (is_timeline_admin / auth.jwt() checks) are shown inline where they appear.
