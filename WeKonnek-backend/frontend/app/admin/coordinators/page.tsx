"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Eye,
  FileText,
  KeyRound,
  Mail,
  MapPin,
  Pause,
  BadgePercent,
  Phone,
  Save,
  Search,
  UserCheck,
  UserPlus,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import { getToken } from "@/hooks/use-auth";
import { publicAssetUrl } from "@/lib/public-asset-url";
import toast from "react-hot-toast";

interface CoordinatorApplication {
  id: number;
  fullName: string;
  mobileNumber: string;
  email: string;
  cityMunicipality: string;
  coordinatorCode?: string;
  userId?: string;
  viberAccount?: string;
  whatsappNumber?: string;
  region?: string;
  provinceDistrict?: string;
  barangay?: string;
  preferredCoverageArea?: string;
  latitude?: string | number;
  longitude?: string | number;
  background?: string;
  occupation?: string;
  motivation?: string;
  monthlyCapacity?: string;
  referred?: string;
  governmentIdFrontUrl?: string;
  governmentIdBackUrl?: string;
  resumeUrl?: string;
  supportingDocumentUrl?: string;
  adminNotes?: string;
  status: string;
  submittedAt: string;
  managementZoneId?: string | null;
  managementZone?: {
    id: string;
    name: string;
    code: string;
    coverages: {
      cityMunicipalityName: string;
      congressionalDistrict: string;
    }[];
  } | null;
  currentMonthCommission?: number;
}
interface CoordinatorStats {
  applicants: number;
  pending: number;
  coordinators: number;
  activeCoverageAreas: number;
}
interface CoordinatorZone {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  coverages: { cityMunicipalityName: string; congressionalDistrict: string }[];
}
type GeneratedAccess = {
  title: string;
  applicationId: number;
  coordinatorCode: string;
  email?: string;
  temporaryPassword?: string;
  resetKey?: string;
  expiresAt?: string;
  viberAccount?: string;
  whatsappNumber?: string;
};
type ManagedMerchant = {
  id: number;
  merchant_id?: number;
  business_name: string;
  contact_name?: string;
  email: string;
  phone?: string;
  category_name?: string;
  city_municipality?: string;
  geographic_area?: string;
  status: string;
  assigned_coordinator_id?: string;
  merchant_code?: string;
  recovery_key?: string;
};
type CommissionLedger = { coordinator: { id: number; full_name: string; coordinator_code?: string }; current_month: number; all_time: number; months: Array<{ key: string; label: string; total: number; merchants: Array<{ merchant_id: number | null; merchant_name: string; amount: number; transactions: number }> }> };

export default function CoordinatorManagementPage() {
  const [applications, setApplications] = useState<CoordinatorApplication[]>(
    [],
  );
  const [stats, setStats] = useState<CoordinatorStats>({
    applicants: 0,
    pending: 0,
    coordinators: 0,
    activeCoverageAreas: 0,
  });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [zones, setZones] = useState<CoordinatorZone[]>([]);
  const [zoneSelections, setZoneSelections] = useState<Record<number, string>>(
    {},
  );
  const [selectedApplication, setSelectedApplication] =
    useState<CoordinatorApplication | null>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [updatingApplicationStatus, setUpdatingApplicationStatus] =
    useState(false);
  const [generatedAccess, setGeneratedAccess] =
    useState<GeneratedAccess | null>(null);
  const [temporaryAccess, setTemporaryAccess] = useState<
    Record<number, GeneratedAccess>
  >({});
  const [managedCoordinator, setManagedCoordinator] =
    useState<CoordinatorApplication | null>(null);
  const [managedMerchants, setManagedMerchants] = useState<ManagedMerchant[]>(
    [],
  );
  const [managedMerchantsLoading, setManagedMerchantsLoading] = useState(false);
  const [commissionLedger, setCommissionLedger] = useState<CommissionLedger | null>(null);
  const [commissionLedgerLoading, setCommissionLedgerLoading] = useState(false);
  const [commissionSettingsOpen, setCommissionSettingsOpen] = useState(false);
  const [commissionRate, setCommissionRate] = useState("");
  const [currentCommissionRate, setCurrentCommissionRate] = useState<number | null>(null);
  const [commissionSettingsLoading, setCommissionSettingsLoading] = useState(false);
  const [commissionSettingsSaving, setCommissionSettingsSaving] = useState(false);
  const [applicationSummaryOpen, setApplicationSummaryOpen] = useState(false);

  const openCommissionSettings = async () => {
    setCommissionSettingsOpen(true);
    setCommissionSettingsLoading(true);
    try {
      const response = await fetch("/api/backend/coordinator-applications/commission-settings", {
        headers: { Authorization: `Bearer ${getToken()}` },
        cache: "no-store",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message || "Unable to load commission settings");
      const rate = Number(body.rate ?? 0);
      setCurrentCommissionRate(rate);
      setCommissionRate(String(rate));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load commission settings");
      setCommissionSettingsOpen(false);
    } finally {
      setCommissionSettingsLoading(false);
    }
  };

  const saveCommissionSettings = async () => {
    const rate = Number(commissionRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast.error("Enter a commission percentage from 0 to 100");
      return;
    }
    setCommissionSettingsSaving(true);
    try {
      const response = await fetch("/api/backend/coordinator-applications/commission-settings", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ rate }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message || "Unable to save commission settings");
      const savedRate = Number(body.rate);
      setCurrentCommissionRate(savedRate);
      setCommissionRate(String(savedRate));
      setCommissionSettingsOpen(false);
      toast.success(`Coordinator commission set to ${body.rate}%`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save commission settings");
    } finally {
      setCommissionSettingsSaving(false);
    }
  };

  const openCommissionLedger = async (coordinator: CoordinatorApplication) => {
    setCommissionLedgerLoading(true);
    try {
      const response = await fetch(`/api/backend/coordinator-applications/${coordinator.id}/commission-ledger`, { headers: { Authorization: `Bearer ${getToken()}` }, cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message || 'Unable to load commission ledger');
      setCommissionLedger(body);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load commission ledger');
    } finally {
      setCommissionLedgerLoading(false);
    }
  };

  const openManagedMerchants = async (coordinator: CoordinatorApplication) => {
    setManagedCoordinator(coordinator);
    setManagedMerchants([]);
    setManagedMerchantsLoading(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const [response, adminMerchantsResponse] = await Promise.all([
        fetch("/api/backend/merchant-applications", { headers, cache: "no-store" }),
        fetch("/api/backend/merchants/admin", { headers, cache: "no-store" }),
      ]);
      const body = await response.json().catch(() => []);
      const adminMerchantsBody = await adminMerchantsResponse.json().catch(() => []);
      if (!response.ok)
        throw new Error(body?.message || "Unable to load managed merchants");
      const all = (
        Array.isArray(body) ? body : body?.data || []
      ) as ManagedMerchant[];
      const adminMerchants: Array<{
        id: number;
        merchant_code?: string;
        recovery_key?: string;
      }> = Array.isArray(adminMerchantsBody)
        ? adminMerchantsBody
        : adminMerchantsBody?.data || [];
      const accountsByCode = new Map<string, {
        id: number;
        merchant_code?: string;
        recovery_key?: string;
      }>();
      adminMerchants.forEach((merchant) => {
        if (merchant.merchant_code) {
          accountsByCode.set(merchant.merchant_code, merchant);
        }
      });
      setManagedMerchants(
        all.filter(
          (merchant) => merchant.assigned_coordinator_id === coordinator.userId,
        ).map((merchant) => {
          const account = merchant.merchant_code
            ? accountsByCode.get(merchant.merchant_code)
            : undefined;
          return {
            ...merchant,
            merchant_id: account?.id,
            recovery_key: account?.recovery_key,
          };
        }),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to load managed merchants",
      );
    } finally {
      setManagedMerchantsLoading(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        setLoadError("");
        const headers = { Authorization: `Bearer ${getToken()}` };
        const [applicationsResponse, statsResponse, zonesResponse, commissionResponse] =
          await Promise.all([
            fetch("/api/backend/coordinator-applications", { headers }),
            fetch("/api/backend/coordinator-applications/stats", { headers }),
            fetch("/api/backend/management-zones", { headers }),
            fetch("/api/backend/coordinator-applications/commission-settings", {
              headers,
              cache: "no-store",
            }),
          ]);
        if (!applicationsResponse.ok || !statsResponse.ok || !zonesResponse.ok)
          throw new Error("Unable to load coordinator applications");
        const loadedApplications: CoordinatorApplication[] =
          await applicationsResponse.json();
        setApplications(loadedApplications);
        setStats(await statsResponse.json());
        setZones(await zonesResponse.json());
        if (commissionResponse.ok) {
          const commission = await commissionResponse.json();
          const rate = Number(commission.rate ?? 0);
          setCurrentCommissionRate(rate);
          setCommissionRate(String(rate));
        }
        setZoneSelections(
          Object.fromEntries(
            loadedApplications
              .filter((item) => item.managementZoneId)
              .map((item) => [item.id, item.managementZoneId as string]),
          ),
        );
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : "Unable to load coordinator applications",
        );
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const updateStatus = async (
    id: number,
    nextStatus: "approved" | "rejected",
  ): Promise<CoordinatorApplication | null> => {
    const previousStatus = applications.find((item) => item.id === id)?.status;
    const managementZoneId = zoneSelections[id];
    if (nextStatus === "approved" && !managementZoneId) {
      setLoadError("Select a coordinator zone before approving the applicant");
      return null;
    }
    setUpdatingApplicationStatus(true);
    try {
      const response = await fetch(
        `/api/backend/coordinator-applications/${id}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({ status: nextStatus, managementZoneId }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoadError(body.message || "Unable to update coordinator");
        return null;
      }
      setLoadError("");
      setApplications((current) =>
        current.map((application) =>
          application.id === id ? body : application,
        ),
      );
      if (previousStatus === "pending")
        setStats((current) => ({
          ...current,
          pending: Math.max(0, current.pending - 1),
          coordinators:
            current.coordinators + (nextStatus === "approved" ? 1 : 0),
          activeCoverageAreas:
            current.activeCoverageAreas + (nextStatus === "approved" ? 1 : 0),
        }));
      if (body.credentials) {
        const access = {
          title: "Coordinator account created",
          ...body.credentials,
        } as GeneratedAccess;
        setGeneratedAccess(access);
        setTemporaryAccess((current) => ({ ...current, [id]: access }));
      }
      return body as CoordinatorApplication;
    } finally {
      setUpdatingApplicationStatus(false);
    }
  };

  const reviewApplicationStatus = async (
    nextStatus: "approved" | "rejected",
  ) => {
    if (!selectedApplication) return;
    const updated = await updateStatus(selectedApplication.id, nextStatus);
    if (!updated) return;
    setSelectedApplication(null);
    setApplicationSummaryOpen(false);
    toast.success(
      nextStatus === "approved"
        ? "Coordinator application approved."
        : "Coordinator application rejected.",
    );
  };

  const suspendCoordinator = async (application: CoordinatorApplication) => {
    if (
      !window.confirm(`Suspend ${application.fullName}'s coordinator access?`)
    )
      return;
    const response = await fetch(
      `/api/backend/coordinator-applications/${application.id}/suspend`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${getToken()}` },
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      toast.error(body.message || "Unable to suspend coordinator");
      return;
    }
    setApplications((current) =>
      current.map((item) => (item.id === body.id ? body : item)),
    );
    toast.success("Coordinator account suspended.");
  };

  const generateResetKey = async (application: CoordinatorApplication) => {
    const response = await fetch(
      `/api/backend/coordinator-applications/${application.id}/reset-key`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      toast.error(body.message || "Unable to generate reset key");
      return;
    }
    const access: GeneratedAccess = {
      title: "Password reset key generated",
      applicationId: application.id,
      email: application.email,
      viberAccount: application.viberAccount,
      whatsappNumber: application.whatsappNumber,
      ...body,
    };
    setGeneratedAccess(access);
    setTemporaryAccess((current) => ({ ...current, [application.id]: access }));
  };

  const openReview = (application: CoordinatorApplication) => {
    setSelectedApplication(application);
    setAdminNotes(application.adminNotes || "");
  };

  const saveNotes = async () => {
    if (!selectedApplication) return;
    setSavingNotes(true);
    try {
      const response = await fetch(
        `/api/backend/coordinator-applications/${selectedApplication.id}/notes`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({ adminNotes }),
        },
      );
      const updated = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(updated.message || "Unable to save staff notes");
      setApplications((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSelectedApplication(updated);
      setAdminNotes(updated.adminNotes || "");
      toast.success("Staff notes saved.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save staff notes",
      );
    } finally {
      setSavingNotes(false);
    }
  };

  const filtered = useMemo(
    () =>
      applications.filter((application) => {
        if (!["approved", "suspended"].includes(application.status))
          return false;
        const query = search.trim().toLowerCase();
        const zoneCoverage =
          application.managementZone?.coverages.flatMap((item) => [
            item.cityMunicipalityName,
            item.congressionalDistrict,
          ]) || [];
        const matchesSearch =
          !query ||
          [
            application.fullName,
            application.coordinatorCode,
            application.email,
            application.mobileNumber,
            application.cityMunicipality,
            application.barangay,
            application.preferredCoverageArea,
            application.managementZone?.name,
            application.managementZone?.code,
            ...zoneCoverage,
          ].some((value) => value?.toLowerCase().includes(query));
        return (
          matchesSearch && (status === "all" || application.status === status)
        );
      }),
    [applications, search, status],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * rowsPerPage;
  const visible = filtered.slice(pageStart, pageStart + rowsPerPage);
  const pendingApplications = useMemo(
    () => applications.filter((application) => application.status === "pending"),
    [applications],
  );
  useEffect(() => setPage(1), [search, status, rowsPerPage]);

  const cards = [
    {
      label: "Total Coordinators",
      note: "All approved coordinators",
      value: stats.coordinators,
      icon: UserCheck,
      color: "text-emerald-600 bg-emerald-50",
    },
    {
      label: "Coordinator Applicants",
      note: "Awaiting review",
      value: stats.applicants,
      icon: ClipboardList,
      color: "text-blue-600 bg-blue-50",
    },
    {
      label: "Pending Applications",
      note: "Pending your action",
      value: stats.pending,
      icon: UsersRound,
      color: "text-amber-600 bg-amber-50",
    },
    {
      label: "Active Coverage Areas",
      note: "Areas with active coordinators",
      value: stats.activeCoverageAreas,
      icon: MapPin,
      color: "text-violet-600 bg-violet-50",
    },
  ];

  return (
    <div className="w-full space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-black text-[#101a33]">
            Coordinator Management
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Review applications, assignments, coverage areas, and coordinator
            status.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/admin/coordinator-resources" className="inline-flex h-14 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 font-bold text-slate-700 transition hover:border-[#e60012] hover:bg-red-50 hover:text-[#e60012]">
            <BookOpen size={20} />
            Coordinator Resources
          </Link>
          <button type="button" onClick={openCommissionSettings} className="inline-flex h-14 items-center justify-center gap-2 rounded-xl border border-[#e60012] bg-white px-6 font-bold text-[#e60012] transition hover:bg-red-50">
            <BadgePercent size={20} />
            <span>Commission</span>
            <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-black tabular-nums">
              {currentCommissionRate === null ? "Loading…" : `${currentCommissionRate}%`}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setApplicationSummaryOpen(true)}
            className="relative inline-flex h-14 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#e60012] px-6 font-bold text-white shadow-lg shadow-red-200 transition hover:bg-red-700"
          >
            <UserPlus size={20} />
            Onboard Coordinator
            {stats.pending > 0 && (
              <span className="absolute -right-2 -top-2 flex min-w-7 items-center justify-center rounded-full border-2 border-white bg-amber-400 px-1.5 py-0.5 text-xs font-black text-slate-950">
                {stats.pending > 99 ? "99+" : stats.pending}
              </span>
            )}
          </button>
        </div>
      </header>
      {loadError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {loadError}. Please confirm the backend service is running, then
          refresh this page.
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, note, value, icon: Icon, color }) => (
          <div
            key={label}
            className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <span
              className={`flex size-14 shrink-0 items-center justify-center rounded-xl ${color}`}
            >
              <Icon size={25} />
            </span>
            <div>
              <p className="text-xs font-bold text-slate-700">{label}</p>
              <p className="mt-1 text-2xl font-black text-[#101a33]">
                {loading ? "—" : value}
              </p>
              <p className="mt-1 text-xs text-slate-500">{note}</p>
            </div>
          </div>
        ))}
      </div>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row">
          <label className="relative flex-1">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              size={19}
            />
            <span className="sr-only">Search coordinators</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search coordinators by name, email, contact, zone..."
              className="h-12 w-full rounded-xl border border-slate-200 pl-12 pr-4 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-12 rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none"
          >
            <option value="all">All statuses</option>
            <option value="approved">Approved</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-[#e60012] text-white">
              <tr>
                <th className="w-14 px-5 py-5">
                  <input
                    type="checkbox"
                    aria-label="Select visible coordinators"
                    checked={
                      visible.length > 0 &&
                      visible.every((item) => selectedIds.includes(item.id))
                    }
                    onChange={(event) =>
                      setSelectedIds(
                        event.target.checked
                          ? [
                              ...new Set([
                                ...selectedIds,
                                ...visible.map((item) => item.id),
                              ]),
                            ]
                          : selectedIds.filter(
                              (id) => !visible.some((item) => item.id === id),
                            ),
                      )
                    }
                    className="size-4 accent-white"
                  />
                </th>
                {[
                  "Coordinator",
                  "Contact",
                  "Coordinator Zone",
                  "Assigned Area",
                  "Earned This Month",
                  "Status",
                  "Action",
                ].map((label) => (
                  <th
                    key={label}
                    className="whitespace-nowrap px-4 py-5 font-bold"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-slate-500">
                    Loading coordinators…
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-slate-500">
                    No onboarded coordinators found.
                  </td>
                </tr>
              ) : (
                visible.map((application) => (
                  <tr key={application.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-5">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(application.id)}
                        onChange={(event) =>
                          setSelectedIds((current) =>
                            event.target.checked
                              ? [...current, application.id]
                              : current.filter((id) => id !== application.id),
                          )
                        }
                        aria-label={`Select ${application.fullName}`}
                        className="size-4 accent-[#e60012]"
                      />
                    </td>
                    <td className="px-4 py-5">
                      <div className="flex min-w-[190px] items-center gap-3">
                        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-blue-100 font-black text-blue-600">
                          {application.fullName
                            .split(" ")
                            .map((part) => part[0])
                            .join("")
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>
                        <div>
                          <p className="font-bold text-[#101a33]">
                            {application.fullName}
                          </p>
                          <p className="mt-1 font-mono text-xs font-bold text-blue-700">
                            {application.coordinatorCode || "ID unavailable"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-5">
                      <div className="min-w-[210px] space-y-1.5">
                        <p className="flex items-center gap-2 text-slate-700">
                          <Mail size={15} className="text-slate-400" />
                          {application.email || "N/A"}
                        </p>
                        <p className="flex items-center gap-2 text-slate-500">
                          <Phone size={15} />
                          {application.mobileNumber || "N/A"}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-5">
                      {application.managementZone ? (
                        <div className="min-w-[210px]">
                          <p className="font-bold text-blue-700">
                            {application.managementZone.code ||
                              application.managementZone.name}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {application.managementZone.coverages
                              .slice(0, 2)
                              .map(
                                (item) =>
                                  `${item.cityMunicipalityName} · ${item.congressionalDistrict}`,
                              )
                              .join(", ") || application.managementZone.name}
                          </p>
                        </div>
                      ) : (
                        <span className="text-red-600">Not assigned</span>
                      )}
                    </td>
                    <td className="px-4 py-5">
                      <div className="min-w-[160px]">
                        <p className="font-semibold text-slate-800">
                          {application.barangay ||
                            application.preferredCoverageArea ||
                            "Area unavailable"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {application.cityMunicipality}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-5">
                      <p className="font-black text-emerald-700">₱{Number(application.currentMonthCommission || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      <p className="mt-1 text-xs text-slate-500">Commission allotted</p>
                    </td>
                    <td className="px-4 py-5">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${application.status === "suspended" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}
                      >
                        {application.status}
                      </span>
                    </td>
                    <td className="px-4 py-5">
                      <div className="flex flex-nowrap gap-2">
                        <CoordinatorAction
                          label="View Commission Ledger"
                          className="border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                          onClick={() => openCommissionLedger(application)}
                        >
                          <WalletCards size={19} />
                        </CoordinatorAction>
                        <CoordinatorAction
                          label="View Coordinator"
                          className="border-blue-200 text-blue-600 hover:bg-blue-50"
                          onClick={() => openReview(application)}
                        >
                          <Eye size={19} />
                        </CoordinatorAction>
                        <CoordinatorAction
                          label="View Managed Merchants"
                          className="border-slate-200 text-slate-600 hover:bg-slate-100"
                          onClick={() => openManagedMerchants(application)}
                        >
                          <BookOpen size={19} />
                        </CoordinatorAction>
                        <CoordinatorAction
                          label="Reset Coordinator Key"
                          disabled={application.status !== "approved"}
                          className="border-amber-200 text-amber-600 hover:bg-amber-50"
                          onClick={() => generateResetKey(application)}
                        >
                          <KeyRound size={19} />
                        </CoordinatorAction>
                        <CoordinatorAction
                          label="Suspend Coordinator"
                          disabled={application.status !== "approved"}
                          className="border-red-200 text-red-600 hover:bg-red-50"
                          onClick={() => suspendCoordinator(application)}
                        >
                          <Pause size={19} />
                        </CoordinatorAction>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <footer className="flex flex-col gap-4 border-t border-slate-200 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-slate-600">
            {filtered.length
              ? `Showing ${pageStart + 1} to ${Math.min(pageStart + rowsPerPage, filtered.length)} of ${filtered.length} coordinators`
              : "Showing 0 coordinators"}
          </p>
          <div className="flex items-center gap-3">
            <button
              aria-label="Previous page"
              disabled={safePage === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="flex size-10 items-center justify-center rounded-lg bg-[#e60012] font-bold text-white">
              {safePage}
            </span>
            <button
              aria-label="Next page"
              disabled={safePage === totalPages}
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronRight size={18} />
            </button>
            <label className="ml-2 flex items-center gap-2 text-slate-500">
              Rows per page:
              <select
                value={rowsPerPage}
                onChange={(event) => setRowsPerPage(Number(event.target.value))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-800"
              >
                {[5, 10, 20, 50].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
        </footer>
      </section>
      {selectedApplication && (
        <ApplicationReviewModal
          application={selectedApplication}
          notes={adminNotes}
          onNotesChange={setAdminNotes}
          onSaveNotes={saveNotes}
          savingNotes={savingNotes}
          zones={zones}
          selectedZoneId={zoneSelections[selectedApplication.id] || ""}
          onZoneChange={(zoneId) =>
            setZoneSelections((current) => ({
              ...current,
              [selectedApplication.id]: zoneId,
            }))
          }
          onApprove={() => void reviewApplicationStatus("approved")}
          onReject={() => void reviewApplicationStatus("rejected")}
          updatingStatus={updatingApplicationStatus}
          onClose={() => setSelectedApplication(null)}
        />
      )}
      {applicationSummaryOpen && (
        <CoordinatorApplicationSummaryModal
          applications={pendingApplications}
          loading={loading}
          onClose={() => setApplicationSummaryOpen(false)}
          onReview={(application) => {
            setApplicationSummaryOpen(false);
            openReview(application);
          }}
        />
      )}
      {generatedAccess && (
        <GeneratedAccessModal
          data={generatedAccess}
          onClose={() => setGeneratedAccess(null)}
        />
      )}
      {managedCoordinator && (
        <ManagedMerchantsModal
          coordinator={managedCoordinator}
          merchants={managedMerchants}
          loading={managedMerchantsLoading}
          onClose={() => setManagedCoordinator(null)}
        />
      )}
      {commissionLedgerLoading && <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/40"><div className="rounded-xl bg-white px-6 py-4 font-bold text-slate-700 shadow-xl">Loading commission ledger…</div></div>}
      {commissionLedger && <CommissionLedgerModal ledger={commissionLedger} onClose={() => setCommissionLedger(null)} />}
      {commissionSettingsOpen && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="commission-settings-title">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
              <div><p className="text-xs font-bold uppercase tracking-wide text-[#e60012]">Coordinator earnings</p><h2 id="commission-settings-title" className="mt-1 text-xl font-black text-[#101a33]">Commission percentage</h2></div>
              <button type="button" onClick={() => setCommissionSettingsOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close commission settings"><X size={22} /></button>
            </header>
            <div className="p-6">
              <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-blue-600">Current commission</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-[#101a33]">
                  {currentCommissionRate === null ? "—" : `${currentCommissionRate}%`}
                </p>
              </div>
              <label htmlFor="coordinator-commission-rate" className="text-sm font-bold text-slate-700">Edit commission rate</label>
              <div className="relative mt-2"><input id="coordinator-commission-rate" type="number" min="0" max="100" step="0.01" value={commissionRate} disabled={commissionSettingsLoading} onChange={(event) => setCommissionRate(event.target.value)} className="h-14 w-full rounded-xl border border-slate-300 px-4 pr-12 text-lg font-bold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /><span className="absolute right-4 top-1/2 -translate-y-1/2 font-black text-slate-500">%</span></div>
              <p className="mt-3 text-sm leading-6 text-slate-500">This percentage is paid from WEKONNEK&apos;s merchant fee revenue—not gross merchant sales. It applies to collected fixed daily tier fees and variable tier fees on completed system orders net of VAT. It affects future eligible fees only.</p>
              <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setCommissionSettingsOpen(false)} className="h-11 rounded-xl border border-slate-300 px-5 font-bold text-slate-700">Cancel</button><button type="button" onClick={saveCommissionSettings} disabled={commissionSettingsLoading || commissionSettingsSaving} className="h-11 rounded-xl bg-[#e60012] px-5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">{commissionSettingsSaving ? "Saving…" : "Save commission"}</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CoordinatorApplicationSummaryModal({
  applications,
  loading,
  onClose,
  onReview,
}: {
  applications: CoordinatorApplication[];
  loading: boolean;
  onClose: () => void;
  onReview: (application: CoordinatorApplication) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[950] flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="coordinator-applications-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <div className="flex items-center gap-3">
              <h2
                id="coordinator-applications-title"
                className="text-2xl font-black text-[#101a33]"
              >
                Coordinator applications
              </h2>
              {!loading && (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-800">
                  {applications.length} for review
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Review applicants awaiting admin action and open their full
              application details.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Close coordinator applications"
          >
            <X size={22} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {[0, 1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-44 animate-pulse rounded-xl bg-slate-100"
                />
              ))}
            </div>
          ) : applications.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
              <UserCheck size={34} className="text-emerald-600" />
              <h3 className="mt-3 text-lg font-black text-[#101a33]">
                No applications awaiting review
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                New coordinator applications will appear here.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {applications.map((application) => {
                const area = [
                  application.barangay || application.preferredCoverageArea,
                  application.cityMunicipality,
                ]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <article
                    key={application.id}
                    className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-black text-[#101a33]">
                          {application.fullName}
                        </h3>
                        <p className="mt-1 truncate text-sm text-slate-500">
                          {application.email}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black uppercase text-amber-800">
                        Pending
                      </span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-xs font-bold uppercase text-slate-400">
                          Mobile
                        </dt>
                        <dd className="mt-1 font-medium text-slate-700">
                          {application.mobileNumber || "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-bold uppercase text-slate-400">
                          Submitted
                        </dt>
                        <dd className="mt-1 font-medium text-slate-700">
                          {application.submittedAt
                            ? new Date(application.submittedAt).toLocaleDateString()
                            : "—"}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-xs font-bold uppercase text-slate-400">
                          Requested coverage
                        </dt>
                        <dd className="mt-1 font-medium text-slate-700">
                          {area || "Not specified"}
                        </dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      onClick={() => onReview(application)}
                      className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 font-bold text-white transition hover:bg-blue-700"
                    >
                      <Eye size={17} /> Review application
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CoordinatorAction({
  label,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`flex size-10 shrink-0 items-center justify-center rounded-lg border bg-white transition disabled:cursor-not-allowed disabled:opacity-35 ${className || ""}`}
      {...props}
    >
      {children}
    </button>
  );
}

function ManagedMerchantsModal({ coordinator, merchants, loading, onClose }: { coordinator: CoordinatorApplication; merchants: ManagedMerchant[]; loading: boolean; onClose: () => void }) {
  const [recoveryMerchant, setRecoveryMerchant] = useState<ManagedMerchant | null>(null);
  const [generating, setGenerating] = useState(false);

  const generateRecoveryKey = async () => {
    if (!recoveryMerchant?.merchant_id) return;
    setGenerating(true);
    try {
      const response = await fetch(
        `/api/backend/merchants/admin/${recoveryMerchant.merchant_id}/recovery-key`,
        { method: "POST", headers: { Authorization: `Bearer ${getToken()}` } },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "Unable to generate recovery key");
      setRecoveryMerchant((current) => current ? { ...current, recovery_key: body.recovery_key } : current);
      toast.success("Merchant recovery key generated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to generate recovery key");
    } finally {
      setGenerating(false);
    }
  };

  const copyRecoveryKey = async () => {
    if (!recoveryMerchant?.recovery_key) return;
    try {
      await navigator.clipboard.writeText(recoveryMerchant.recovery_key);
      toast.success("Recovery key copied.");
    } catch {
      toast.error("Unable to copy the recovery key.");
    }
  };

  return <div className="fixed inset-0 z-[1050] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="managed-merchants-title">
    <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <header className="flex items-start justify-between border-b border-slate-200 px-6 py-5"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-600">Managed merchants</p><h2 id="managed-merchants-title" className="mt-1 text-xl font-black text-[#101a33]">{coordinator.fullName}</h2><p className="mt-1 text-sm text-slate-500">{coordinator.coordinatorCode || 'Coordinator ID unavailable'} · {merchants.length} merchant{merchants.length === 1 ? '' : 's'}</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close managed merchants"><X size={22} /></button></header>
      <div className="min-h-0 overflow-y-auto p-5">{loading ? <div className="p-12 text-center text-sm text-slate-500">Loading managed merchants…</div> : merchants.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center"><BookOpen className="mx-auto mb-3 text-slate-400" /><p className="font-bold text-slate-700">No merchants assigned</p><p className="mt-1 text-sm text-slate-500">Merchants onboarded or assigned to this coordinator will appear here.</p></div> : <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Merchant', 'Contact', 'Category', 'Coverage', 'Status', 'Action'].map(label => <th key={label} className="px-4 py-3 font-bold">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-200">{merchants.map(merchant => <tr key={merchant.id}><td className="px-4 py-4"><p className="font-bold text-[#101a33]">{merchant.business_name}</p><p className="mt-1 font-mono text-xs text-blue-700">{merchant.merchant_code || 'Awaiting Store ID'}</p></td><td className="px-4 py-4"><p className="text-slate-700">{merchant.email || 'N/A'}</p><p className="mt-1 text-xs text-slate-500">{merchant.phone || 'N/A'}</p></td><td className="px-4 py-4 text-slate-700">{merchant.category_name || 'N/A'}</td><td className="px-4 py-4"><p className="text-slate-700">{merchant.geographic_area || 'Area unavailable'}</p><p className="mt-1 text-xs text-slate-500">{merchant.city_municipality || 'City unavailable'}</p></td><td className="px-4 py-4"><span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${merchant.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : merchant.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{merchant.status.replaceAll('_', ' ')}</span></td><td className="px-4 py-4"><button type="button" disabled={!merchant.merchant_id || merchant.status !== 'approved'} onClick={() => setRecoveryMerchant(merchant)} title={merchant.status === 'approved' ? 'Merchant password recovery key' : 'Available after merchant approval'} className="inline-flex h-10 items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"><KeyRound size={16} /> Recovery key</button></td></tr>)}</tbody></table></div>}</div>
    </div>
    {recoveryMerchant && <div className="fixed inset-0 z-[1060] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="merchant-recovery-title"><div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"><header className="flex items-start justify-between border-b border-slate-200 px-6 py-5"><div><p className="text-xs font-bold uppercase text-amber-700">Password recovery</p><h3 id="merchant-recovery-title" className="mt-1 text-xl font-black text-[#101a33]">{recoveryMerchant.business_name}</h3><p className="mt-1 font-mono text-xs text-slate-500">{recoveryMerchant.merchant_code}</p></div><button type="button" onClick={() => setRecoveryMerchant(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close recovery key"><X size={21} /></button></header><div className="p-6"><p className="text-xs font-bold uppercase text-slate-500">Current recovery key</p><div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="break-all font-mono text-sm font-bold text-amber-900">{recoveryMerchant.recovery_key || 'No recovery key has been generated.'}</p></div><p className="mt-3 text-xs leading-5 text-slate-500">Generating a new key immediately invalidates the merchant&apos;s previous recovery key.</p><div className="mt-6 flex flex-wrap justify-end gap-3">{recoveryMerchant.recovery_key && <button type="button" onClick={copyRecoveryKey} className="h-11 rounded-xl border border-amber-500 px-5 font-bold text-amber-700">Copy key</button>}<button type="button" onClick={generateRecoveryKey} disabled={generating} className="h-11 rounded-xl bg-amber-600 px-5 font-bold text-white disabled:opacity-60">{generating ? 'Generating…' : recoveryMerchant.recovery_key ? 'Rotate key' : 'Generate key'}</button></div></div></div></div>}
  </div>;
}

function CommissionLedgerModal({ ledger, onClose }: { ledger: CommissionLedger; onClose: () => void }) {
  return <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="commission-ledger-title">
    <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <header className="flex items-start justify-between border-b border-slate-200 px-6 py-5"><div><p className="text-xs font-bold uppercase tracking-wide text-emerald-600">Coordinator commission ledger</p><h2 id="commission-ledger-title" className="mt-1 text-xl font-black text-[#101a33]">{ledger.coordinator.full_name}</h2><p className="mt-1 text-sm text-slate-500">{ledger.coordinator.coordinator_code || 'Coordinator ID unavailable'}</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close commission ledger"><X size={22} /></button></header>
      <div className="min-h-0 overflow-y-auto p-5 sm:p-6"><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-emerald-50 p-4"><p className="text-xs font-bold uppercase text-emerald-700">Earned this month</p><p className="mt-2 text-2xl font-black text-emerald-800">₱{ledger.current_month.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div><div className="rounded-xl bg-blue-50 p-4"><p className="text-xs font-bold uppercase text-blue-700">All-time commission</p><p className="mt-2 text-2xl font-black text-blue-800">₱{ledger.all_time.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div></div>
        <section className="mt-6"><h3 className="mb-3 font-black text-[#101a33]">Monthly earnings</h3>{ledger.months.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center"><WalletCards className="mx-auto mb-3 text-slate-400" /><p className="font-bold text-slate-700">No commission credits recorded</p><p className="mt-1 text-sm text-slate-500">Completed earning transactions will appear here by month and merchant.</p></div> : <div className="space-y-3">{ledger.months.map((month, index) => <details key={month.key} open={index === 0} className="overflow-hidden rounded-xl border border-slate-200"><summary className="flex cursor-pointer list-none items-center justify-between bg-slate-50 px-4 py-4"><div><p className="font-black text-slate-900">{month.label}</p><p className="mt-1 text-xs text-slate-500">{month.merchants.length} merchant{month.merchants.length === 1 ? '' : 's'}</p></div><p className="text-lg font-black text-emerald-700">₱{month.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></summary><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-y border-slate-200 bg-white text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Merchant</th><th className="px-4 py-3">Commission entries</th><th className="px-4 py-3 text-right">Amount earned</th></tr></thead><tbody className="divide-y divide-slate-100">{month.merchants.map(merchant => <tr key={`${month.key}-${merchant.merchant_id || merchant.merchant_name}`}><td className="px-4 py-4 font-bold text-slate-800">{merchant.merchant_name}</td><td className="px-4 py-4 text-slate-500">{merchant.transactions}</td><td className="px-4 py-4 text-right font-black text-emerald-700">₱{merchant.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>)}</tbody></table></div></details>)}</div>}</section>
      </div>
    </div>
  </div>;
}

function ApplicationReviewModal({
  application,
  notes,
  onNotesChange,
  onSaveNotes,
  savingNotes,
  onClose,
}: {
  application: CoordinatorApplication;
  notes: string;
  onNotesChange: (value: string) => void;
  onSaveNotes: () => void;
  savingNotes: boolean;
  zones: CoordinatorZone[];
  selectedZoneId: string;
  onZoneChange: (zoneId: string) => void;
  onApprove: () => void;
  onReject: () => void;
  updatingStatus: boolean;
  onClose: () => void;
}) {
  const details = [
    ["Full name", application.fullName],
    ["Email", application.email],
    ["Mobile", application.mobileNumber],
    ["Viber", application.viberAccount],
    ["WhatsApp", application.whatsappNumber],
    ["Status", application.status],
    ["Region", application.region],
    ["Province / District", application.provinceDistrict],
    ["City / Municipality", application.cityMunicipality],
    ["Barangay", application.barangay],
    ["Preferred coverage", application.preferredCoverageArea],
    [
      "Coordinates",
      application.latitude && application.longitude
        ? `${application.latitude}, ${application.longitude}`
        : null,
    ],
    ["Background", application.background],
    ["Occupation / Organization", application.occupation],
    ["Monthly capacity", application.monthlyCapacity],
    ["Referred", application.referred],
  ];
  const documents = [
    ["Government ID — front", application.governmentIdFrontUrl],
    ["Government ID — back", application.governmentIdBackUrl],
    ["Resume / Profile", application.resumeUrl],
    ["Supporting document", application.supportingDocumentUrl],
  ];
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-blue-600">
              Coordinator application #{application.id}
            </p>
            <h2 id="review-title" className="text-xl font-black text-slate-900">
              {application.fullName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Close review"
          >
            <X size={22} />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-6 p-6">
            <section>
              <h3 className="mb-3 font-black text-slate-900">
                Application details
              </h3>
              <dl className="grid gap-3 sm:grid-cols-2">
                {details.map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-slate-50 p-3">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      {label}
                    </dt>
                    <dd className="mt-1 break-words text-sm font-medium text-slate-800">
                      {value || "—"}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
            <section>
              <h3 className="mb-2 font-black text-slate-900">
                Applicant motivation
              </h3>
              <p className="min-h-20 whitespace-pre-wrap rounded-xl border border-slate-200 p-4 text-sm leading-6 text-slate-700">
                {application.motivation || "No motivation statement submitted."}
              </p>
            </section>
          </div>
          <aside className="space-y-6 border-t border-slate-200 bg-slate-50 p-6 lg:border-l lg:border-t-0">
            <section>
              <h3 className="mb-3 flex items-center gap-2 font-black text-slate-900">
                <FileText size={18} /> Submitted documents
              </h3>
              <div className="space-y-2">
                {documents.map(([label, url]) =>
                  url ? (
                    <a
                      key={label}
                      href={publicAssetUrl(url)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-blue-700 hover:border-blue-300"
                    >
                      <span>{label}</span>
                      <ExternalLink size={15} />
                    </a>
                  ) : (
                    <div
                      key={label}
                      className="flex items-center justify-between rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-400"
                    >
                      <span>{label}</span>
                      <span className="text-xs">Not submitted</span>
                    </div>
                  ),
                )}
              </div>
            </section>
            <section>
              <label className="block font-black text-slate-900">
                Admin staff notes
                <textarea
                  value={notes}
                  onChange={(event) => onNotesChange(event.target.value)}
                  rows={8}
                  placeholder="Add verification findings, follow-up items, or internal review notes…"
                  className="mt-3 block w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-sm font-normal leading-5 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <button
                onClick={onSaveNotes}
                disabled={savingNotes}
                className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 font-bold text-white disabled:opacity-60"
              >
                <Save size={17} />
                {savingNotes ? "Saving…" : "Save staff notes"}
              </button>
            </section>
            {application.status === "pending" && (
              <section className="border-t border-slate-200 pt-6">
                <label
                  htmlFor="coordinator-zone"
                  className="block text-sm font-black text-slate-900"
                >
                  Coordinator zone
                </label>
                <select
                  id="coordinator-zone"
                  value={selectedZoneId}
                  onChange={(event) => onZoneChange(event.target.value)}
                  disabled={updatingStatus}
                  className="mt-3 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                >
                  <option value="">Select a zone to approve</option>
                  {zones
                    .filter((zone) => zone.isActive)
                    .map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.code} — {zone.name}
                      </option>
                    ))}
                </select>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  A zone assignment is required before this coordinator can be approved.
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={onReject}
                    disabled={updatingStatus}
                    className="h-11 rounded-xl border border-red-300 bg-white font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {updatingStatus ? "Processing…" : "Reject"}
                  </button>
                  <button
                    type="button"
                    onClick={onApprove}
                    disabled={updatingStatus || !selectedZoneId}
                    className="h-11 rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {updatingStatus ? "Processing…" : "Approve"}
                  </button>
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function GeneratedAccessModal({
  data,
  onClose,
}: {
  data: GeneratedAccess;
  onClose: () => void;
}) {
  const rows = [
    ["Coordinator user ID", data.coordinatorCode],
    ["Contact email", data.email],
    ["Temporary password", data.temporaryPassword],
    ["Reset key", data.resetKey],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  const copyAll = () => {
    const text = buildCredentialMessage(data);
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Access details copied."));
  };
  const share = (channel: "email" | "whatsapp" | "viber") => {
    const message = buildCredentialMessage(data);
    if (channel === "email") {
      window.location.href = `mailto:${encodeURIComponent(data.email || "")}?subject=${encodeURIComponent("Your WeKonnek Coordinator Access")}&body=${encodeURIComponent(message)}`;
      return;
    }
    if (channel === "whatsapp") {
      const number = (data.whatsappNumber || "")
        .replace(/\D/g, "")
        .replace(/^0/, "63");
      window.open(
        `https://wa.me/${number}?text=${encodeURIComponent(message)}`,
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }
    window.location.href = `viber://forward?text=${encodeURIComponent(message)}`;
  };
  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-blue-600">
              One-time access details
            </p>
            <h2 className="mt-1 text-xl font-black text-slate-900">
              {data.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          >
            <X size={21} />
          </button>
        </div>
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-medium leading-5 text-amber-800">
          Send these details securely. The coordinator must use the
          password-change link within 30 minutes; the temporary credentials and
          reset key expire after that window.
        </p>
        <dl className="mt-4 space-y-3">
          {rows.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-slate-50 p-3">
              <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {label}
              </dt>
              <dd className="mt-1 break-all font-mono text-sm font-bold text-slate-900">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        {data.expiresAt && (
          <p className="mt-3 text-xs text-slate-500">
            Reset key expires: {new Date(data.expiresAt).toLocaleString()}
          </p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            onClick={copyAll}
            className="h-11 rounded-xl bg-blue-600 text-sm font-bold text-white"
          >
            Copy
          </button>
          <button
            onClick={() => share("email")}
            disabled={!data.email}
            className="h-11 rounded-xl bg-slate-100 text-sm font-bold text-slate-700 disabled:opacity-40"
          >
            Email
          </button>
          <button
            onClick={() => share("whatsapp")}
            disabled={!data.whatsappNumber}
            className="h-11 rounded-xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-40"
          >
            WhatsApp
          </button>
          <button
            onClick={() => share("viber")}
            disabled={!data.viberAccount}
            className="h-11 rounded-xl bg-violet-600 text-sm font-bold text-white disabled:opacity-40"
          >
            Viber
          </button>
        </div>
        <button
          onClick={onClose}
          className="mt-3 h-11 w-full rounded-xl border border-slate-300 px-5 font-bold text-slate-700"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function buildCredentialMessage(data: GeneratedAccess) {
  const resetUrl = data.resetKey
    ? `${window.location.origin}/coordinator/reset-password?key=${encodeURIComponent(data.resetKey)}`
    : "";
  return [
    "Your WeKonnek Zone Coordinator account is ready.",
    "",
    `Coordinator user ID: ${data.coordinatorCode}`,
    data.email ? `Contact email: ${data.email}` : "",
    data.temporaryPassword
      ? `Temporary password: ${data.temporaryPassword}`
      : "",
    data.resetKey ? `Reset key: ${data.resetKey}` : "",
    resetUrl ? `Change password: ${resetUrl}` : "",
    "",
    "For your security, access the link and change your password within 30 minutes. Do not share these credentials with anyone.",
  ]
    .filter(Boolean)
    .join("\n");
}
