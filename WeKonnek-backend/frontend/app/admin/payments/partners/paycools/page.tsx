"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";
import { getToken, getUser } from "@/hooks/use-auth";

type Config = Record<string, any>;
type SecretField = "merchantPrivateKey" | "callbackSecret";
const editableFields = [
  "baseUrl",
  "appId",
  "appName",
  "merchantPublicKey",
  "channelCode",
  "healthcheckUrl",
  "ipWhitelistRequired",
  "publicKeyRegistered",
  "callbackRegistered",
  "ipWhitelistConfirmed",
];
const sourceLabels: Record<string, string> = {
  RESTAURANT_ORDER: "Restaurant Orders",
  RETAIL_ORDER: "Retail Orders",
  ADVANCE_ORDER: "Advance Orders",
  TAKE_OUT: "Take-Out",
  RESERVATION: "Reservations",
  MERCHANT_SUBSCRIPTION: "Merchant Subscription",
  DELIVERY_ORDER: "Delivery",
  SERVICE_BOOKING: "Service Booking",
  BAZAAR_LISTING: "Bazaar",
  PROPERTY_LISTING: "Property",
};
const display = (value?: string) =>
  ({
    NOT_CONFIGURED: "Not Configured",
    READY_TO_TEST: "Ready to Test",
    HEALTHY: "Healthy",
    ERROR: "Error",
    NOT_READY: "Not Ready",
    READY_FOR_TESTING: "Ready for Testing",
    READY: "Ready",
    ACTIVE: "Active",
  })[value || ""] ||
  value ||
  "—";
function Toggle({
  value,
  disabled,
  onChange,
}: {
  value: boolean;
  disabled?: boolean;
  onChange?: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange?.(!value)}
      className={`h-6 w-11 rounded-full p-1 transition ${value ? "bg-emerald-500" : "bg-gray-300"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      aria-pressed={value}
    >
      <span
        className={`block h-4 w-4 rounded-full bg-white transition ${value ? "translate-x-5" : ""}`}
      />
    </button>
  );
}
function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-gray-500">
        {title}
      </h2>
      {children}
    </section>
  );
}
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-gray-100 py-3 last:border-0">
      <span className="text-sm text-gray-700">{label}</span>
      {children}
    </div>
  );
}
function Status({ value }: { value: string }) {
  return (
    <b
      className={
        value === "HEALTHY" || value === "READY" || value === "ACTIVE"
          ? "text-emerald-600"
          : value === "ERROR"
            ? "text-red-600"
            : "text-amber-600"
      }
    >
      {display(value)}
    </b>
  );
}
function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
function draftFrom(entry: Config) {
  return Object.fromEntries(
    editableFields.map((field) => [
      field,
      entry[field] ??
        (field.includes("Registered") ||
        field.includes("Confirmed") ||
        field === "ipWhitelistRequired"
          ? false
          : ""),
    ]),
  );
}

function EnvironmentPanel({
  entry,
  draft,
  editing,
  dirty,
  canEdit,
  saving,
  callbackUrl,
  onEdit,
  onChange,
  onSave,
  onClose,
  onSecret,
}: {
  entry: Config;
  draft?: Config;
  editing: boolean;
  dirty: boolean;
  canEdit: boolean;
  saving: boolean;
  callbackUrl: string;
  onEdit: () => void;
  onChange: (field: string, value: unknown) => void;
  onSave: () => void;
  onClose: () => void;
  onSecret: (field: SecretField, value: string) => void;
}) {
  const [privateKey, setPrivateKey] = useState("");
  const [callbackSecret, setCallbackSecret] = useState("");
  const values = draft || entry;
  const disabled = !editing || saving;
  const submitSecret = (field: SecretField, value: string) => {
    if (value.trim()) onSecret(field, value);
  };
  return (
    <details className="rounded-xl border border-gray-200 p-4">
      <summary className="cursor-pointer font-bold text-slate-800">
        {entry.environment === "uat" ? "UAT" : "Production"} Configuration
      </summary>
      <div className="mt-5 grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium">
            Base URL
            <input
              value={textValue(values.baseUrl)}
              placeholder={
                entry.environment === "uat"
                  ? "https://api-uat.paycools.com"
                  : "https://api.paycools.com"
              }
              disabled={disabled}
              onChange={(event) => onChange("baseUrl", event.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 disabled:bg-gray-50"
            />
          </label>
          <label className="text-sm font-medium">
            App ID
            <input
              value={
                editing
                  ? textValue(values.appId)
                  : textValue(entry.appIdPreview)
              }
              disabled={disabled}
              onChange={(event) => onChange("appId", event.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 disabled:bg-gray-50"
            />
          </label>
          <label className="text-sm font-medium">
            App Name
            <input
              value={textValue(values.appName)}
              disabled={disabled}
              onChange={(event) => onChange("appName", event.target.value)}
              required
              className="mt-1 w-full rounded-lg border px-3 py-2 disabled:bg-gray-50"
            />
          </label>
          <label className="text-sm font-medium">
            Channel Code
            <input
              value={textValue(values.channelCode)}
              placeholder="QRPH_DYNAMIC_QR"
              disabled={disabled}
              onChange={(event) => onChange("channelCode", event.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 disabled:bg-gray-50"
            />
          </label>
        </div>
        <label className="text-sm font-medium">
          Merchant Public Key
          {editing ? (
            <textarea
              value={textValue(values.merchantPublicKey)}
              onChange={(event) =>
                onChange("merchantPublicKey", event.target.value)
              }
              disabled={disabled}
              className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2 font-mono text-xs"
            />
          ) : (
            <div className="mt-1 flex items-center justify-between rounded-lg border bg-gray-50 px-3 py-2">
              <span className="font-mono text-xs">
                {entry.merchantPublicKeyConfigured
                  ? `SHA-256: ••••••••${textValue(entry.merchantPublicKeyFingerprint).slice(-4)}`
                  : "Not Configured"}
              </span>
              <b className="text-xs text-gray-500">
                {entry.merchantPublicKeyConfigured
                  ? "Configured"
                  : "Not Configured"}
              </b>
            </div>
          )}
        </label>
        <label className="text-sm font-medium">
          Healthcheck URL
          <input
            value={textValue(values.healthcheckUrl)}
            disabled={disabled}
            onChange={(event) => onChange("healthcheckUrl", event.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 disabled:bg-gray-50"
          />
        </label>
        <Row label="IP Whitelist Required">
          <Toggle
            value={Boolean(values.ipWhitelistRequired)}
            disabled={disabled}
            onChange={(value) => onChange("ipWhitelistRequired", value)}
          />
        </Row>
        <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
          <b>Payment Callback URL (deployment-managed)</b>
          <p className="mt-1 break-all font-mono">{callbackUrl}</p>
        </div>
        <div className="border-t pt-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">
            UAT Setup Checklist
          </h3>
          <Row label="Public Key Registered">
            <Toggle
              value={Boolean(values.publicKeyRegistered)}
              disabled={disabled}
              onChange={(value) => onChange("publicKeyRegistered", value)}
            />
          </Row>
          <Row label="Callback URL Registered">
            <Toggle
              value={Boolean(values.callbackRegistered)}
              disabled={disabled}
              onChange={(value) => onChange("callbackRegistered", value)}
            />
          </Row>
          {values.ipWhitelistRequired ? (
            <Row label="IP Whitelist Confirmed">
              <Toggle
                value={Boolean(values.ipWhitelistConfirmed)}
                disabled={disabled}
                onChange={(value) => onChange("ipWhitelistConfirmed", value)}
              />
            </Row>
          ) : (
            <Row label="IP Whitelist">
              <b className="text-sm text-gray-500">Not Required</b>
            </Row>
          )}
        </div>
        {editing && (
          <div className="grid gap-3 border-t pt-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-semibold">
                Merchant Private Key{" "}
                <span className="font-normal text-gray-500">
                  —{" "}
                  {entry.privateKeyConfigured ? "Configured" : "Not Configured"}
                </span>
                <textarea
                  value={privateKey}
                  onChange={(event) => setPrivateKey(event.target.value)}
                  autoComplete="new-password"
                  placeholder="Paste a replacement; it is never displayed again"
                  className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2 font-mono text-xs"
                />
              </label>
              <button
                type="button"
                disabled={saving || !privateKey.trim()}
                onClick={() => {
                  submitSecret("merchantPrivateKey", privateKey);
                  setPrivateKey("");
                }}
                className="mt-2 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {entry.privateKeyConfigured
                  ? "Replace Private Key"
                  : "Configure Private Key"}
              </button>
            </div>
            <div>
              <label className="text-sm font-semibold">
                Callback Secret / PayCools Secret Key{" "}
                <span className="font-normal text-gray-500">
                  —{" "}
                  {entry.callbackSecretConfigured
                    ? "Configured"
                    : "Not Configured"}
                </span>
                <input
                  type="password"
                  value={callbackSecret}
                  onChange={(event) => setCallbackSecret(event.target.value)}
                  autoComplete="new-password"
                  placeholder="Paste a replacement secret"
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                />
              </label>
              <button
                type="button"
                disabled={saving || !callbackSecret.trim()}
                onClick={() => {
                  submitSecret("callbackSecret", callbackSecret);
                  setCallbackSecret("");
                }}
                className="mt-2 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {entry.callbackSecretConfigured
                  ? "Replace Callback Secret"
                  : "Configure Callback Secret"}
              </button>
            </div>
          </div>
        )}
        <div className="flex gap-3 pt-2">
          {!editing ? (
            <button
              type="button"
              disabled={!canEdit}
              onClick={onEdit}
              className="rounded-xl bg-[#DB0002] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Edit
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={saving || !dirty}
                onClick={onSave}
                className="rounded-xl bg-[#DB0002] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={onClose}
                className="rounded-xl border px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </details>
  );
}

export default function PayCoolsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingEnvironment, setEditingEnvironment] = useState<string | null>(
    null,
  );
  const [draft, setDraft] = useState<Config | null>(null);
  const [baselineDraft, setBaselineDraft] = useState<Config | null>(null);
  const [pendingSecrets, setPendingSecrets] = useState<
    Partial<Record<SecretField, string>>
  >({});
  const editable = getUser()?.userType === "admin";
  const request = useCallback(async (path = "", options?: RequestInit) => {
    const response = await fetch(
      `/api/backend/admin/payments/partners/paycools${path}`,
      {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
          ...options?.headers,
        },
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || "Request failed");
    return body;
  }, []);
  const load = useCallback(async () => setConfig(await request()), [request]);
  useEffect(() => {
    void load().catch((reason) =>
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load PayCools configuration",
      ),
    );
  }, [load]);
  const savePlatform = async (patch: Config) => {
    setSaving(true);
    setError("");
    try {
      setConfig(
        await request("", { method: "PATCH", body: JSON.stringify(patch) }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };
  const beginEdit = async (entry: Config) => {
    setNotice("");
    setError("");
    setSaving(true);
    try {
      const editableEnvironment = await request(
        `/environments/${entry.environment}`,
      );
      setEditingEnvironment(entry.environment);
      const nextDraft = draftFrom(editableEnvironment);
      setDraft(nextDraft);
      setBaselineDraft(nextDraft);
      setPendingSecrets({});
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load editable configuration",
      );
    } finally {
      setSaving(false);
    }
  };
  const updateDraft = (field: string, value: unknown) =>
    setDraft((current) => ({ ...(current || {}), [field]: value }));
  const queueSecret = (field: SecretField, value: string) =>
    setPendingSecrets((current) => ({ ...current, [field]: value }));
  const closeEdit = () => {
    const dirty = Boolean(
      draft &&
      baselineDraft &&
      (JSON.stringify(draft) !== JSON.stringify(baselineDraft) ||
        Object.values(pendingSecrets).some(Boolean)),
    );
    if (
      dirty &&
      !window.confirm("Discard unsaved PayCools configuration changes?")
    )
      return;
    setEditingEnvironment(null);
    setDraft(null);
    setBaselineDraft(null);
    setPendingSecrets({});
  };
  const saveEnvironment = async () => {
    if (!config || !editingEnvironment || !draft) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await request(`/environments/${editingEnvironment}`, {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      if (pendingSecrets.merchantPrivateKey)
        await request(
          `/environments/${editingEnvironment}/merchant-private-key`,
          {
            method: "POST",
            body: JSON.stringify({
              merchantPrivateKey: pendingSecrets.merchantPrivateKey,
            }),
          },
        );
      if (pendingSecrets.callbackSecret)
        await request(`/environments/${editingEnvironment}/callback-secret`, {
          method: "POST",
          body: JSON.stringify({
            callbackSecret: pendingSecrets.callbackSecret,
          }),
        });
      await load();
      setEditingEnvironment(null);
      setDraft(null);
      setBaselineDraft(null);
      setPendingSecrets({});
      setNotice(
        `${editingEnvironment === "uat" ? "UAT" : "Production"} configuration saved.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Configuration save failed",
      );
    } finally {
      setSaving(false);
    }
  };
  if (!config)
    return (
      <div className="p-8 text-gray-500">
        {error || "Loading PayCools configuration…"}
      </div>
    );
  const readiness = config.readiness || {};
  const connection = config.connection || {};
  const active = config.activeEnvironmentConfig || {};
  const environments = config.paycoolsEnvironments || [];
  const isDirty = (entry: Config) =>
    editingEnvironment === entry.environment &&
    Boolean(
      draft &&
      baselineDraft &&
      (JSON.stringify(draft) !== JSON.stringify(baselineDraft) ||
        Object.values(pendingSecrets).some(Boolean)),
    );
  return (
    <div className="w-full space-y-5">
      <header className="rounded-2xl bg-slate-950 p-6 text-white">
        <p className="text-xs font-bold tracking-[.25em] text-red-300">
          PAYMENT PARTNER
        </p>
        <h1 className="mt-1 text-3xl font-black">PAYCOOLS</h1>
        <p className="mt-2 text-sm text-slate-300">
          Central WEKONNEK payment infrastructure configuration
        </p>
      </header>
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          {notice}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Provider Overview">
          <Row label="Provider status">
            <b>{config.enabled ? "Enabled" : "Disabled"}</b>
          </Row>
          <Row label="Connection">
            <Status value={connection.status} />
          </Row>
          <Row label="Readiness">
            <Status value={readiness.uatStatus} />
          </Row>
          <Row label="Enable PayCools">
            <Toggle
              value={config.enabled}
              disabled={!editable || saving || !readiness.ready}
              onChange={(enabled) => savePlatform({ enabled })}
            />
          </Row>
        </Card>
        <Card title="Environment">
          <div className="space-y-3">
            {(["uat", "production"] as const).map((environment) => (
              <label
                key={environment}
                className="flex items-center gap-3 rounded-xl border p-4"
              >
                <input
                  type="radio"
                  checked={config.environment === environment}
                  disabled={!editable || saving || Boolean(editingEnvironment)}
                  onChange={() => savePlatform({ environment })}
                />
                <span className="font-semibold">
                  {environment === "uat" ? "UAT" : "Production"}
                </span>
              </label>
            ))}
          </div>
        </Card>
        <Card title="Security & Credentials">
          <Row label="Base URL">
            <b
              className={
                config.credentials?.baseUrlConfigured
                  ? "text-emerald-600"
                  : "text-gray-400"
              }
            >
              {config.credentials?.baseUrlConfigured
                ? "Configured ✓"
                : "Not Configured"}
            </b>
          </Row>
          <Row label="App ID">
            <span className="flex items-center gap-3">
              <code className="text-xs">{active.appIdPreview || "—"}</code>
              <b
                className={
                  config.credentials?.appIdConfigured
                    ? "text-emerald-600"
                    : "text-gray-400"
                }
              >
                {config.credentials?.appIdConfigured
                  ? "Configured ✓"
                  : "Not Configured"}
              </b>
            </span>
          </Row>
          <Row label="Merchant Public Key">
            <span className="flex items-center gap-3">
              <code className="text-xs">
                {active.merchantPublicKeyFingerprint
                  ? `SHA-256: ••••••••${String(active.merchantPublicKeyFingerprint).slice(-4)}`
                  : "—"}
              </code>
              <b
                className={
                  active.merchantPublicKeyConfigured
                    ? "text-emerald-600"
                    : "text-gray-400"
                }
              >
                {active.merchantPublicKeyConfigured
                  ? "Configured ✓"
                  : "Not Configured"}
              </b>
            </span>
          </Row>
          <Row label="Private Key">
            <b
              className={
                active.privateKeyConfigured
                  ? "text-emerald-600"
                  : "text-gray-400"
              }
            >
              {active.privateKeyConfigured ? "Configured ✓" : "Not Configured"}
            </b>
          </Row>
          <Row label="Callback Secret">
            <b
              className={
                active.callbackSecretConfigured
                  ? "text-emerald-600"
                  : "text-gray-400"
              }
            >
              {active.callbackSecretConfigured
                ? "Configured ✓"
                : "Not Configured"}
            </b>
          </Row>
          <Row label="Public Key Registration">
            <b
              className={
                active.publicKeyRegistered
                  ? "text-emerald-600"
                  : "text-gray-400"
              }
            >
              {active.publicKeyRegistered ? "Confirmed ✓" : "Not Confirmed"}
            </b>
          </Row>
          <Row label="IP Whitelist">
            <b
              className={
                !active.ipWhitelistRequired || active.ipWhitelistConfirmed
                  ? "text-emerald-600"
                  : "text-gray-400"
              }
            >
              {!active.ipWhitelistRequired
                ? "Not Required"
                : active.ipWhitelistConfirmed
                  ? "Confirmed ✓"
                  : "Not Confirmed"}
            </b>
          </Row>
        </Card>
      </div>
      <Card title="PayCools Environment Credentials">
        <div className="space-y-3">
          {environments.map((entry: Config) => (
            <EnvironmentPanel
              key={entry.environment}
              entry={entry}
              draft={
                editingEnvironment === entry.environment
                  ? draft || undefined
                  : undefined
              }
              editing={editingEnvironment === entry.environment}
              dirty={isDirty(entry)}
              canEdit={
                editable &&
                (!editingEnvironment ||
                  editingEnvironment === entry.environment)
              }
              saving={saving}
              callbackUrl={config.callbackUrls?.payment || ""}
              onEdit={() => void beginEdit(entry)}
              onChange={updateDraft}
              onSave={() => void saveEnvironment()}
              onClose={closeEdit}
              onSecret={queueSecret}
            />
          ))}
        </div>
      </Card>
      <Card title="Available For">
        {Object.entries(sourceLabels).map(([key, label]) => (
          <Row key={key} label={label}>
            <Toggle
              value={Boolean(
                config.sources?.find((source: any) => source.sourceType === key)
                  ?.enabled,
              )}
              disabled={!editable || saving || Boolean(editingEnvironment)}
              onChange={(value) => savePlatform({ sources: { [key]: value } })}
            />
          </Row>
        ))}
      </Card>
    </div>
  );
}
