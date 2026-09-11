create index idx_jmr_unit on public.job_material_requirements(unit);
create index idx_ptl_unit on public.product_template_lines(unit);
create index idx_pt_output_unit on public.product_templates(output_unit);
create index idx_sr_warehouse on public.stock_reservations(warehouse_id);
