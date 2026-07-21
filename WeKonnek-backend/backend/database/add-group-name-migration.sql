-- ============================================================
-- Migration: Add group_name column to sub_categories
-- ============================================================
-- This enables grouping of subcategories within a category for UI display.
-- For example, under "Shops": Electronics, Fashion, Home & Living, Specialty, Hardware
-- Under "Services": Household, Personal, Automotive, Logistics
--
-- Run this BEFORE the updated category-seed-data.sql

ALTER TABLE public.sub_categories
  ADD COLUMN IF NOT EXISTS group_name VARCHAR(100) DEFAULT NULL;

COMMENT ON COLUMN public.sub_categories.group_name IS
  'Optional grouping label for UI display (e.g. Electronics, Fashion, Household, Automotive)';
