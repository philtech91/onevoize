'use client'

import { FormEvent, useEffect, useState } from 'react'
import {
  CheckCircle2,
  Clock,
  Download,
  Mail,
  Printer,
  RefreshCw,
  Send,
  AlertCircle,
  FileEdit,
  UserPlus,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { siteConfig } from '@/lib/site'

type SubmittedApplication = {
  id?: number
  full_name: string
  email: string
  phone: string
  address: string
  occupation: string
  application_reason: string
  membership_no: string
  status: 'pending' | 'active' | 'inactive' | 'suspended'
  created_at?: string
  updated_at?: string
}

type FormValues = {
  full_name: string
  email: string
  phone: string
  address: string
  occupation: string
  reason: string
}

const STORAGE_KEY = 'ovc_submitted_membership_application_v1'

const initialFormValues: FormValues = {
  full_name: '',
  email: '',
  phone: '',
  address: '',
  occupation: '',
  reason: '',
}

export function MembershipForm() {
  const [values, setValues] = useState<FormValues>(initialFormValues)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormValues, string>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [errorBanner, setErrorBanner] = useState('')
  const [infoMessage, setInfoMessage] = useState('')
  const [submittedApp, setSubmittedApp] = useState<SubmittedApplication | null>(null)
  const [isEditingExisting, setIsEditingExisting] = useState(false)
  const [refreshingStatus, setRefreshingStatus] = useState(false)

  // Restore previously submitted application from localStorage and refresh live status
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as SubmittedApplication
      if (parsed && parsed.email && parsed.full_name) {
        setSubmittedApp(parsed)
        void refreshApplicationStatus(parsed.membership_no, parsed.email, false)
      }
    } catch {
      // Ignore storage parse errors
    }
  }, [])

  async function refreshApplicationStatus(ref?: string, email?: string, showFeedback = true) {
    if (!ref && !email) return
    if (showFeedback) setRefreshingStatus(true)
    try {
      const params = new URLSearchParams()
      if (ref) params.set('ref', ref)
      if (email) params.set('email', email)
      const res = await fetch(`/api/membership?${params.toString()}`)
      if (!res.ok) return
      const data = await res.json()
      if (data?.found && data?.application) {
        setSubmittedApp((prev) => {
          const merged: SubmittedApplication = {
            ...(prev || {}),
            ...data.application,
            occupation: data.application.occupation || prev?.occupation || '',
            application_reason:
              data.application.application_reason || prev?.application_reason || '',
          }
          try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
          } catch {
            // ignore
          }
          return merged
        })
        if (showFeedback) {
          setInfoMessage('Application status refreshed from club records.')
        }
      }
    } catch {
      // Ignore network errors during background check
    } finally {
      if (showFeedback) setRefreshingStatus(false)
    }
  }

  function validateField(name: keyof FormValues, rawValue: string): string {
    const val = rawValue.trim()
    switch (name) {
      case 'full_name':
        return val.length < 2 ? 'Please enter your full name (at least 2 characters).' : ''
      case 'email':
        return !val || !val.includes('@') || !val.includes('.')
          ? 'Please enter a valid email address.'
          : ''
      case 'phone':
        return val.length < 5 ? 'Please enter a valid phone number.' : ''
      case 'occupation':
        return val.length < 2 ? 'Please enter your occupation.' : ''
      case 'address':
        return val.length < 8
          ? 'Please enter your residential address (at least 8 characters).'
          : ''
      case 'reason':
        return val.length < 20
          ? 'Please write at least 20 characters explaining why you would like to join.'
          : ''
      default:
        return ''
    }
  }

  function handleFieldChange(name: keyof FormValues, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }))
    // Reset error state on input as soon as the user attempts a correction
    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: '' }))
    }
    if (errorBanner) setErrorBanner('')
  }

  function handleFieldBlur(name: keyof FormValues) {
    const err = validateField(name, values[name])
    if (err) {
      setFieldErrors((prev) => ({ ...prev, [name]: err }))
    }
  }

  function validateAll(): boolean {
    const nextErrors: Partial<Record<keyof FormValues, string>> = {}
    ;(Object.keys(values) as Array<keyof FormValues>).forEach((key) => {
      const msg = validateField(key, values[key])
      if (msg) nextErrors[key] = msg
    })
    setFieldErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorBanner('')
    setInfoMessage('')

    if (!validateAll()) {
      setErrorBanner('Please review the highlighted fields before submitting.')
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        ...values,
        ...(isEditingExisting && submittedApp?.membership_no
          ? { membership_no: submittedApp.membership_no }
          : {}),
      }
      const res = await fetch('/api/membership', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit membership application.')
      }

      const app: SubmittedApplication = {
        id: data.application?.id,
        full_name: data.application?.full_name || values.full_name.trim(),
        email: data.application?.email || values.email.trim(),
        phone: data.application?.phone || values.phone.trim(),
        address: data.application?.address || values.address.trim(),
        occupation: data.application?.occupation || values.occupation.trim(),
        application_reason: data.application?.application_reason || values.reason.trim(),
        membership_no: data.application?.membership_no || 'OVC-PENDING',
        status: data.application?.status || 'pending',
        created_at: data.application?.created_at || new Date().toISOString(),
        updated_at: data.application?.updated_at || new Date().toISOString(),
      }

      setSubmittedApp(app)
      setIsEditingExisting(false)
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(app))
      } catch {
        // Ignore localStorage quota issues
      }

      if (data.updated) {
        setInfoMessage('Your pending membership application has been updated and saved.')
      } else if (data.alreadyRegistered) {
        setInfoMessage('An application with this email is already on file. Showing your current record.')
      } else {
        setInfoMessage('Your membership application has been submitted and is pending committee review.')
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : 'Could not submit online. You can still use the Email or Download options below.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  function buildApplicationDocument(source: {
    full_name: string
    email: string
    phone: string
    address: string
    occupation: string
    reason: string
    membership_no?: string
    status?: string
    submitted_at?: string
  }) {
    const statusLabel =
      source.status === 'active'
        ? 'APPROVED / ACTIVE MEMBER'
        : source.status
          ? 'SUBMITTED — PENDING COMMITTEE REVIEW'
          : 'DRAFT APPLICATION'

    return [
      '============================================================',
      `${siteConfig.legalName}`,
      'MEMBERSHIP REGISTRATION APPLICATION',
      '============================================================',
      `Application Reference : ${source.membership_no || 'Pending Assignment'}`,
      `Application Status    : ${statusLabel}`,
      `Date                  : ${
        source.submitted_at
          ? new Date(source.submitted_at).toLocaleString('en-NG')
          : new Date().toLocaleString('en-NG')
      }`,
      '------------------------------------------------------------',
      '',
      `Full Name             : ${source.full_name || '[Not provided]'}`,
      `Email Address         : ${source.email || '[Not provided]'}`,
      `Phone Number          : ${source.phone || '[Not provided]'}`,
      `Occupation            : ${source.occupation || '[Not provided]'}`,
      '',
      'Residential Address:',
      source.address || '[Not provided]',
      '',
      'Why would you like to join?:',
      source.reason || '[Not provided]',
      '',
      '------------------------------------------------------------',
      `Club Secretariat Email: ${siteConfig.contactEmail}`,
      `Registered Office     : ${siteConfig.registeredAddress}`,
      '============================================================',
    ].join('\n')
  }

  function handleMailto(useSubmittedRecord = false) {
    const data = useSubmittedRecord && submittedApp
      ? {
          full_name: submittedApp.full_name,
          email: submittedApp.email,
          phone: submittedApp.phone,
          address: submittedApp.address,
          occupation: submittedApp.occupation,
          reason: submittedApp.application_reason,
          membership_no: submittedApp.membership_no,
          status: submittedApp.status,
          submitted_at: submittedApp.created_at,
        }
      : {
          full_name: values.full_name,
          email: values.email,
          phone: values.phone,
          address: values.address,
          occupation: values.occupation,
          reason: values.reason,
        }

    const subject = data.membership_no
      ? `Global Voize Club Membership Application (${data.membership_no}) — ${data.full_name}`
      : `New Global Voize Club membership application${data.full_name ? ` — ${data.full_name}` : ''}`

    const body = [
      data.membership_no ? `Application Reference: ${data.membership_no}` : null,
      data.status ? `Registration Status: Submitted (Pending Review)` : null,
      `Full name:\n${data.full_name || ''}`,
      `Email address:\n${data.email || ''}`,
      `Phone number:\n${data.phone || ''}`,
      `Residential address:\n${data.address || ''}`,
      `Occupation:\n${data.occupation || ''}`,
      `Why would you like to join?:\n${data.reason || ''}`,
    ]
      .filter(Boolean)
      .join('\n\n')

    const mailtoUrl =
      `mailto:${siteConfig.contactEmail}?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`

    window.location.href = mailtoUrl
    setInfoMessage('Your email draft is ready in your email app. Please review and send it.')
  }

  function handleDownloadCopy(useSubmittedRecord = false) {
    const data = useSubmittedRecord && submittedApp
      ? {
          full_name: submittedApp.full_name,
          email: submittedApp.email,
          phone: submittedApp.phone,
          address: submittedApp.address,
          occupation: submittedApp.occupation,
          reason: submittedApp.application_reason,
          membership_no: submittedApp.membership_no,
          status: submittedApp.status,
          submitted_at: submittedApp.created_at,
        }
      : {
          full_name: values.full_name,
          email: values.email,
          phone: values.phone,
          address: values.address,
          occupation: values.occupation,
          reason: values.reason,
        }

    const content = buildApplicationDocument(data)
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const slug = (data.full_name || 'applicant')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    link.href = url
    link.download = `one-voize-membership-${data.membership_no || slug}.txt`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setInfoMessage('Membership application copy downloaded.')
  }

  function handleEditSubmitted() {
    if (!submittedApp) return
    setValues({
      full_name: submittedApp.full_name || '',
      email: submittedApp.email || '',
      phone: submittedApp.phone || '',
      address: submittedApp.address || '',
      occupation: submittedApp.occupation || '',
      reason: submittedApp.application_reason || '',
    })
    setIsEditingExisting(true)
    setInfoMessage('')
    setErrorBanner('')
  }

  function handleStartFreshApplication() {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    setSubmittedApp(null)
    setIsEditingExisting(false)
    setValues(initialFormValues)
    setFieldErrors({})
    setInfoMessage('')
    setErrorBanner('')
  }

  // Show Submitted & Pending Review View when an application has been submitted and not actively being edited
  if (submittedApp && !isEditingExisting) {
    const isApproved = submittedApp.status === 'active'
    const isPending = submittedApp.status === 'pending'

    return (
      <Card className="w-full overflow-hidden shadow-sm">
        <CardHeader className="border-b bg-muted/20 px-5 py-6 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                Application Submitted
              </span>

              {isPending && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 px-3 py-1 text-xs font-semibold text-amber-800 dark:text-amber-300">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  Pending Review
                </span>
              )}

              {isApproved && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Approved — Active Member
                </span>
              )}
            </div>

            <span className="font-mono text-xs font-semibold text-muted-foreground bg-background border rounded-md px-2.5 py-1">
              Ref: {submittedApp.membership_no}
            </span>
          </div>

          <CardTitle className="font-serif text-2xl sm:text-3xl">
            {isApproved
              ? 'Welcome to Global Voize Club!'
              : 'Application Received & Pending Review'}
          </CardTitle>

          <p className="text-sm leading-6 text-muted-foreground">
            {isApproved
              ? 'Your membership application has been reviewed and approved by the committee.'
              : 'Your registration details have been securely saved. Our membership screening committee is currently reviewing your application.'}
          </p>
        </CardHeader>

        <CardContent className="space-y-6 px-5 py-6 sm:px-8">
          <div
            role="status"
            aria-live="polite"
            className={`rounded-xl border p-4 text-sm leading-6 ${
              isApproved
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-200'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">
                  Status: {isApproved ? 'Approved (Active Member)' : 'Submitted — Pending Committee Review'}
                </p>
                <p className="mt-1 text-xs opacity-90">
                  {infoMessage ||
                    'You can download a copy of your submitted registration or send it via your email app at any time using the buttons below.'}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={refreshingStatus}
                onClick={() =>
                  refreshApplicationStatus(submittedApp.membership_no, submittedApp.email, true)
                }
                className="shrink-0 h-8 text-xs bg-background/80"
              >
                <RefreshCw
                  className={`mr-1.5 h-3.5 w-3.5 ${refreshingStatus ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {refreshingStatus ? 'Checking…' : 'Check Status'}
              </Button>
            </div>
          </div>

          {/* Stored Registration Summary */}
          <div className="rounded-xl border bg-muted/15 p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Submitted Registration Details
              </h3>
              {submittedApp.created_at && (
                <span className="text-xs text-muted-foreground">
                  Submitted {new Date(submittedApp.created_at).toLocaleDateString('en-NG')}
                </span>
              )}
            </div>

            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Full Name</dt>
                <dd className="mt-0.5 font-medium text-foreground">{submittedApp.full_name}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Email Address</dt>
                <dd className="mt-0.5 font-medium text-foreground break-all">{submittedApp.email}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Phone Number</dt>
                <dd className="mt-0.5 font-medium text-foreground">{submittedApp.phone}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Occupation</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {submittedApp.occupation || '—'}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium text-muted-foreground">Residential Address</dt>
                <dd className="mt-0.5 text-foreground">{submittedApp.address}</dd>
              </div>
              {submittedApp.application_reason && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium text-muted-foreground">
                    Why would you like to join?
                  </dt>
                  <dd className="mt-0.5 text-foreground whitespace-pre-line">
                    {submittedApp.application_reason}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Keep Download, Print & Mailto Options */}
          <div className="space-y-3 pt-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Download &amp; Email Options
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleDownloadCopy(true)}
                className="w-full justify-center"
              >
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Download Copy
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => window.print()}
                className="w-full justify-center"
              >
                <Printer className="mr-2 h-4 w-4" aria-hidden="true" />
                Print / Save PDF
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => handleMailto(true)}
                className="w-full justify-center"
              >
                <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
                Open in Email App
              </Button>
            </div>
          </div>

          {/* Edit or New Application controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            {isPending && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleEditSubmitted}
                className="text-xs"
              >
                <FileEdit className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Edit Pending Application
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleStartFreshApplication}
              className="text-xs text-muted-foreground"
            >
              <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Submit Another Application
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full overflow-hidden shadow-sm">
      <CardHeader className="border-b bg-muted/20 px-5 py-6 sm:px-8">
        <div className="flex items-center justify-between gap-2 mb-3">
          <Badge variant="secondary" className="w-fit">
            {isEditingExisting ? 'Update Pending Application' : 'Application Form'}
          </Badge>
          {isEditingExisting && submittedApp && (
            <span className="font-mono text-xs text-muted-foreground">
              Ref: {submittedApp.membership_no}
            </span>
          )}
        </div>

        <CardTitle className="font-serif text-2xl sm:text-3xl">
          Become a member
        </CardTitle>

        <p className="text-sm leading-6 text-muted-foreground">
          Complete all required fields below to register online for committee review, or use the
          download and email options.
        </p>
      </CardHeader>

      <CardContent className="px-5 py-6 sm:px-8">
        {errorBanner && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{errorBanner}</span>
          </div>
        )}

        {infoMessage && (
          <div
            role="status"
            aria-live="polite"
            className="mb-5 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm leading-6 text-foreground"
          >
            {infoMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="membership-full-name">
              Full name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="membership-full-name"
              name="full_name"
              type="text"
              autoComplete="name"
              required
              minLength={2}
              value={values.full_name}
              onChange={(e) => handleFieldChange('full_name', e.target.value)}
              onBlur={() => handleFieldBlur('full_name')}
              aria-invalid={Boolean(fieldErrors.full_name)}
              aria-describedby={fieldErrors.full_name ? 'err-full-name' : undefined}
              placeholder="Enter full name"
            />
            {fieldErrors.full_name && (
              <p id="err-full-name" className="text-xs text-destructive">
                {fieldErrors.full_name}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="membership-email">
                Email address <span className="text-destructive">*</span>
              </Label>
              <Input
                id="membership-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                required
                value={values.email}
                onChange={(e) => handleFieldChange('email', e.target.value)}
                onBlur={() => handleFieldBlur('email')}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'err-email' : undefined}
                placeholder="Enter email address"
              />
              {fieldErrors.email && (
                <p id="err-email" className="text-xs text-destructive">
                  {fieldErrors.email}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="membership-phone">
                Phone number <span className="text-destructive">*</span>
              </Label>
              <Input
                id="membership-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                value={values.phone}
                onChange={(e) => handleFieldChange('phone', e.target.value)}
                onBlur={() => handleFieldBlur('phone')}
                aria-invalid={Boolean(fieldErrors.phone)}
                aria-describedby={fieldErrors.phone ? 'err-phone' : undefined}
                placeholder="Enter phone number"
              />
              {fieldErrors.phone && (
                <p id="err-phone" className="text-xs text-destructive">
                  {fieldErrors.phone}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="membership-occupation">
              Occupation <span className="text-destructive">*</span>
            </Label>
            <Input
              id="membership-occupation"
              name="occupation"
              type="text"
              autoComplete="organization-title"
              required
              minLength={2}
              value={values.occupation}
              onChange={(e) => handleFieldChange('occupation', e.target.value)}
              onBlur={() => handleFieldBlur('occupation')}
              aria-invalid={Boolean(fieldErrors.occupation)}
              aria-describedby={fieldErrors.occupation ? 'err-occupation' : undefined}
              placeholder="Enter occupation or profession"
            />
            {fieldErrors.occupation && (
              <p id="err-occupation" className="text-xs text-destructive">
                {fieldErrors.occupation}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="membership-address">
              Residential address <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="membership-address"
              name="address"
              autoComplete="street-address"
              required
              minLength={8}
              rows={2}
              value={values.address}
              onChange={(e) => handleFieldChange('address', e.target.value)}
              onBlur={() => handleFieldBlur('address')}
              aria-invalid={Boolean(fieldErrors.address)}
              aria-describedby={fieldErrors.address ? 'err-address' : undefined}
              placeholder="Enter residential address"
              className="resize-y"
            />
            {fieldErrors.address && (
              <p id="err-address" className="text-xs text-destructive">
                {fieldErrors.address}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="membership-reason">
              Why would you like to join? <span className="text-destructive">*</span>
            </Label>
            <p id="membership-reason-hint" className="text-xs text-muted-foreground">
              Share at least 20 characters about how you hope to contribute to ONE VOIZE.
            </p>
            <Textarea
              id="membership-reason"
              name="reason"
              required
              minLength={20}
              value={values.reason}
              onChange={(e) => handleFieldChange('reason', e.target.value)}
              onBlur={() => handleFieldBlur('reason')}
              aria-invalid={Boolean(fieldErrors.reason)}
              aria-describedby={
                fieldErrors.reason
                  ? 'membership-reason-hint err-reason'
                  : 'membership-reason-hint'
              }
              placeholder="Enter why you would like to join"
              className="min-h-32 resize-y"
            />
            {fieldErrors.reason && (
              <p id="err-reason" className="text-xs text-destructive">
                {fieldErrors.reason}
              </p>
            )}
          </div>

          <div className="space-y-3 pt-1">
            <Button type="submit" disabled={submitting} className="w-full">
              <Send className="mr-2 h-4 w-4" aria-hidden="true" />
              {submitting
                ? 'Submitting Application…'
                : isEditingExisting
                  ? 'Save & Update Application'
                  : 'Submit Membership Application'}
            </Button>

            {isEditingExisting && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsEditingExisting(false)}
                className="w-full text-xs"
              >
                Cancel Editing &amp; View Submitted Status
              </Button>
            )}
          </div>

          {/* Keep Download, Print, and Mailto Options */}
          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">
              You can also download a copy of your application or open it directly in your email app:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleMailto(false)}
                className="w-full justify-center"
              >
                <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
                Open Email Application
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => handleDownloadCopy(false)}
                className="w-full justify-center"
              >
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Download Form Copy
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}