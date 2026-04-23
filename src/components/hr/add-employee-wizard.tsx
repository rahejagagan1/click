"use client";

import { useEffect, useMemo, useState } from "react";

interface NumberSeries {
    id: number;
    name: string;
    prefix: string;
    nextNumber: number;
}

interface WizardForm {
    // Page 1 — Basic Details
    workCountry: string;
    firstName: string;
    middleName: string;
    lastName: string;
    displayName: string;
    displayNameTouched: boolean;
    gender: string;
    dateOfBirth: string; // yyyy-mm-dd
    nationality: string;
    numberSeriesId: string;
    workEmail: string;
    mobileNumber: string;
}

const STEPS = [
    { n: 1, label: "BASIC DETAILS" },
    { n: 2, label: "JOB DETAILS" },
    { n: 3, label: "WORK DETAILS" },
    { n: 4, label: "COMPENSATION" },
] as const;

export default function AddEmployeeWizard({
    onClose,
    onCreated,
}: {
    onClose: () => void;
    onCreated: () => void;
}) {
    const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [series, setSeries] = useState<NumberSeries[]>([]);
    const [form, setForm] = useState<WizardForm>({
        workCountry: "India",
        firstName: "",
        middleName: "",
        lastName: "",
        displayName: "",
        displayNameTouched: false,
        gender: "",
        dateOfBirth: "",
        nationality: "",
        numberSeriesId: "",
        workEmail: "",
        mobileNumber: "",
    });

    useEffect(() => {
        fetch("/api/hr/number-series")
            .then(r => r.ok ? r.json() : [])
            .then((data: NumberSeries[]) => {
                setSeries(data);
                if (data.length > 0) {
                    setForm(f => ({ ...f, numberSeriesId: String(data[0].id) }));
                }
            })
            .catch(() => { });
    }, []);

    // Auto-compose display name from first/middle/last until the user edits it.
    useEffect(() => {
        if (form.displayNameTouched) return;
        const parts = [form.firstName, form.middleName, form.lastName].map(s => s.trim()).filter(Boolean);
        setForm(f => ({ ...f, displayName: parts.join(" ") }));
    }, [form.firstName, form.middleName, form.lastName, form.displayNameTouched]);

    const selectedSeries = useMemo(
        () => series.find(s => String(s.id) === form.numberSeriesId) || null,
        [series, form.numberSeriesId],
    );
    const employeeNumberPreview = selectedSeries
        ? `${selectedSeries.prefix}${selectedSeries.nextNumber}`
        : "";

    const updateField = <K extends keyof WizardForm>(key: K, value: WizardForm[K]) =>
        setForm(f => ({ ...f, [key]: value }));

    const page1Invalid = useMemo(() => {
        const req: (keyof WizardForm)[] = [
            "workCountry", "firstName", "lastName", "displayName", "gender",
            "dateOfBirth", "nationality", "numberSeriesId", "workEmail", "mobileNumber",
        ];
        return req.some(k => !String(form[k] ?? "").trim());
    }, [form]);

    const handleContinue = async () => {
        setError(null);
        if (step === 1) {
            if (page1Invalid) { setError("Please fill in all required fields."); return; }
            setStep(2);
            return;
        }
        if (step === 2) { setStep(3); return; }
        if (step === 3) { setStep(4); return; }
        await submit();
    };

    const submit = async () => {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch("/api/hr/employees", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    workCountry: form.workCountry,
                    firstName: form.firstName,
                    middleName: form.middleName || undefined,
                    lastName: form.lastName,
                    displayName: form.displayName,
                    gender: form.gender,
                    dateOfBirth: form.dateOfBirth,
                    nationality: form.nationality,
                    numberSeriesId: Number(form.numberSeriesId),
                    workEmail: form.workEmail,
                    mobileNumber: form.mobileNumber,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                setError(err.error || `Save failed (${res.status})`);
                return;
            }
            onCreated();
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-white dark:bg-[#0a0a1e] z-50 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-6 px-8 py-4 border-b border-slate-200 dark:border-white/[0.06]">
                <h1 className="text-[18px] font-semibold text-slate-900 dark:text-white">Add Employee Wizard</h1>
                <div className="flex-1 flex items-center justify-center gap-10">
                    {STEPS.map((s, i) => {
                        const active = s.n === step;
                        const done = s.n < step;
                        return (
                            <div key={s.n} className="flex items-center gap-3">
                                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-semibold transition-colors ${
                                    active ? "bg-violet-600 text-white"
                                    : done ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40"
                                    : "bg-transparent text-slate-400 border border-slate-300 dark:border-white/20"
                                }`}>
                                    {s.n}
                                </span>
                                <span className={`text-[11px] font-semibold tracking-wider ${
                                    active ? "text-slate-900 dark:text-white" : "text-slate-400"
                                }`}>
                                    {s.label}
                                </span>
                                {i < STEPS.length - 1 && <span className="w-10 h-px bg-slate-300 dark:bg-white/10" />}
                            </div>
                        );
                    })}
                </div>
                <div className="flex items-center gap-3">
                    {step > 1 && (
                        <button
                            onClick={() => { setError(null); setStep(s => (s - 1) as 1 | 2 | 3 | 4); }}
                            className="h-10 px-5 rounded-lg text-[13px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                            Back
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="h-10 px-5 rounded-lg text-[13px] font-medium text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                        Cancel
                    </button>
                    <button
                        onClick={handleContinue}
                        disabled={saving}
                        className="h-10 px-6 rounded-lg text-[13px] font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50">
                        {saving ? "Saving…" : step === 4 ? "Save" : "Continue"}
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto py-10 px-8">
                    {error && (
                        <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-[13px] text-red-600 dark:text-red-400">
                            {error}
                        </div>
                    )}
                    {step === 1 && (
                        <Page1
                            form={form}
                            series={series}
                            employeeNumberPreview={employeeNumberPreview}
                            updateField={updateField}
                        />
                    )}
                    {step === 2 && <ComingSoon label="Job Details" />}
                    {step === 3 && <ComingSoon label="Work Details" />}
                    {step === 4 && <ComingSoon label="Compensation" />}
                </div>
            </div>
        </div>
    );
}

function Page1({
    form, series, employeeNumberPreview, updateField,
}: {
    form: WizardForm;
    series: NumberSeries[];
    employeeNumberPreview: string;
    updateField: <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => void;
}) {
    return (
        <div className="space-y-10">
            <section>
                <h2 className="text-[17px] font-semibold text-slate-900 dark:text-white mb-6">Employee details</h2>

                <Field label="Work Country" required>
                    <select
                        value={form.workCountry}
                        onChange={e => updateField("workCountry", e.target.value)}
                        className={inputClass}>
                        {["India", "United States", "United Kingdom", "United Arab Emirates", "Canada", "Australia", "Singapore"].map(c => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                </Field>

                <div className="grid grid-cols-2 gap-6">
                    <Field label="First Name" required>
                        <input value={form.firstName} onChange={e => updateField("firstName", e.target.value)} className={inputClass} />
                    </Field>
                    <Field label="Middle Name">
                        <input value={form.middleName} onChange={e => updateField("middleName", e.target.value)} className={inputClass} />
                    </Field>
                    <Field label="Last Name" required>
                        <input value={form.lastName} onChange={e => updateField("lastName", e.target.value)} className={inputClass} />
                    </Field>
                    <Field label="Display Name" required>
                        <input
                            value={form.displayName}
                            onChange={e => { updateField("displayName", e.target.value); updateField("displayNameTouched", true); }}
                            className={inputClass} />
                    </Field>
                    <Field label="Gender" required>
                        <select value={form.gender} onChange={e => updateField("gender", e.target.value)} className={inputClass}>
                            <option value="">Select gender</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                        </select>
                    </Field>
                    <Field label="Date of Birth" required>
                        <input type="date" value={form.dateOfBirth} onChange={e => updateField("dateOfBirth", e.target.value)} className={inputClass} />
                    </Field>
                    <Field label="Nationality" required>
                        <input
                            value={form.nationality}
                            onChange={e => updateField("nationality", e.target.value)}
                            placeholder="e.g. Indian"
                            className={inputClass} />
                    </Field>
                    <Field label="Number Series" required>
                        <select value={form.numberSeriesId} onChange={e => updateField("numberSeriesId", e.target.value)} className={inputClass}>
                            {series.length === 0 && <option value="">Loading…</option>}
                            {series.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </Field>
                </div>

                <Field label="Employee Number" required>
                    <input
                        value={employeeNumberPreview}
                        readOnly
                        disabled
                        placeholder="Auto-generated on save"
                        className={`${inputClass} bg-slate-100 dark:bg-white/[0.04] cursor-not-allowed`} />
                    <p className="mt-1 text-[11px] text-slate-500">
                        Auto-allocated from the selected series when you save. The final number may differ if another employee is added concurrently.
                    </p>
                </Field>
            </section>

            <section>
                <h2 className="text-[17px] font-semibold text-slate-900 dark:text-white mb-6">Contact Details</h2>
                <div className="grid grid-cols-2 gap-6">
                    <Field label="Work Email" required>
                        <input type="email" value={form.workEmail} onChange={e => updateField("workEmail", e.target.value.toLowerCase())} placeholder="name@nbmediaproductions.com" className={inputClass} />
                    </Field>
                    <Field label="Mobile Number" required>
                        <input value={form.mobileNumber} onChange={e => updateField("mobileNumber", e.target.value)} placeholder="+91 XXXXXXXXXX" className={inputClass} />
                    </Field>
                </div>
            </section>
        </div>
    );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <div className="mb-5">
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-2">
                {label}
                {required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            {children}
        </div>
    );
}

function ComingSoon({ label }: { label: string }) {
    return (
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-white/10 px-8 py-16 text-center">
            <h2 className="text-[17px] font-semibold text-slate-900 dark:text-white">{label}</h2>
            <p className="mt-2 text-[13px] text-slate-500">This page is not implemented yet. Click Back to edit earlier steps, or Continue to proceed.</p>
        </div>
    );
}

const inputClass = "w-full h-11 px-3 bg-white dark:bg-white/[0.02] border border-slate-300 dark:border-white/10 rounded-lg text-[14px] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/40 transition-colors";
