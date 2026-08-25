"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getToken } from "@/hooks/use-auth";

type Promo = {
  id: number;
  title: string;
  subtitle: string;
  ctaHeading: string;
  ctaText: string;
  isActive: boolean;
  displayOrder: number;
};
const empty = {
  title: "",
  subtitle: "",
  ctaHeading: "Start Selling Today",
  ctaText: "Post your products and connect with local buyers.",
  isActive: true,
  displayOrder: 0,
};

export default function BazaarPromosAdminPage() {
  const [cards, setCards] = useState<Promo[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const headers = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`,
  });
  const load = () =>
    fetch("/api/bazaar-promos", { headers: headers(), cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setCards(Array.isArray(data) ? data : []));
  useEffect(() => {
    void load();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    await fetch(`/api/bazaar-promos${editing ? `/${editing}` : ""}`, {
      method: editing ? "PATCH" : "POST",
      headers: headers(),
      body: JSON.stringify(form),
    });
    setForm(empty);
    setEditing(null);
    setSaving(false);
    await load();
  };
  const edit = (card: Promo) => {
    setEditing(card.id);
    setForm({
      title: card.title,
      subtitle: card.subtitle,
      ctaHeading: card.ctaHeading,
      ctaText: card.ctaText,
      isActive: card.isActive,
      displayOrder: card.displayOrder,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const remove = async (id: number) => {
    if (!confirm("Delete this Bazaar promo card?")) return;
    await fetch(`/api/bazaar-promos/${id}`, {
      method: "DELETE",
      headers: headers(),
    });
    await load();
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <Link href="/admin/bazaar-listings" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-[#e60012]"><ArrowLeft size={16} /> Bazaar Management / Listings</Link>
        <h1 className="text-3xl font-black text-slate-900">
          Bazaar Promotional Cards
        </h1>
        <p className="mt-2 text-slate-600">
          Control the rotating seller messages displayed above Bazaar listings.
          Active cards rotate every seven days.
        </p>
      </div>
      <form
        onSubmit={submit}
        className="grid gap-4 rounded-2xl border bg-white p-5 shadow-sm md:grid-cols-2"
      >
        <label className="text-sm font-bold">
          Title
          <input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="mt-2 w-full rounded-xl border px-4 py-3 font-normal"
            placeholder="Sell on WEKONNEK Bazaar"
          />
        </label>
        <label className="text-sm font-bold">
          Subtitle
          <input
            required
            value={form.subtitle}
            onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
            className="mt-2 w-full rounded-xl border px-4 py-3 font-normal"
          />
        </label>
        <label className="text-sm font-bold">
          CTA heading
          <input
            required
            value={form.ctaHeading}
            onChange={(e) => setForm({ ...form, ctaHeading: e.target.value })}
            className="mt-2 w-full rounded-xl border px-4 py-3 font-normal"
          />
        </label>
        <label className="text-sm font-bold">
          CTA description
          <input
            required
            value={form.ctaText}
            onChange={(e) => setForm({ ...form, ctaText: e.target.value })}
            className="mt-2 w-full rounded-xl border px-4 py-3 font-normal"
          />
        </label>
        <label className="text-sm font-bold">
          Display order
          <input
            type="number"
            value={form.displayOrder}
            onChange={(e) =>
              setForm({ ...form, displayOrder: Number(e.target.value) })
            }
            className="mt-2 w-full rounded-xl border px-4 py-3 font-normal"
          />
        </label>
        <label className="flex items-center gap-2 self-end py-3 text-sm font-bold">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            className="size-5"
          />{" "}
          Active on customer Bazaar
        </label>
        <div className="flex gap-3 md:col-span-2">
          <button
            disabled={saving}
            className="rounded-xl bg-red-600 px-6 py-3 font-bold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : editing ? "Update Card" : "Add Card"}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setForm(empty);
              }}
              className="rounded-xl border px-6 py-3 font-bold"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <article
            key={card.id}
            className="rounded-2xl border bg-white p-5 shadow-sm"
          >
            <div className="flex justify-between gap-3">
              <div>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${card.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                >
                  {card.isActive ? "Active" : "Hidden"} · Order{" "}
                  {card.displayOrder}
                </span>
                <h2 className="mt-3 text-lg font-black">{card.title}</h2>
                <p className="mt-1 text-sm text-slate-500">{card.subtitle}</p>
                <p className="mt-4 text-sm font-bold">{card.ctaHeading}</p>
                <p className="text-xs text-slate-500">{card.ctaText}</p>
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => edit(card)}
                className="rounded-lg bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700"
              >
                Edit
              </button>
              <button
                onClick={() => remove(card.id)}
                className="rounded-lg bg-red-50 px-4 py-2 text-sm font-bold text-red-700"
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
