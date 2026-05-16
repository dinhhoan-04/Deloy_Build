import { useState } from 'react'

interface Step {
  title: string
  description: string
  icon: React.ReactNode
}

function DocumentIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h8l5 5v15a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <polyline points="15,3 15,8 20,8" />
      <line x1="9" y1="13" x2="17" y2="13" />
      <line x1="9" y1="17" x2="14" y2="17" />
    </svg>
  )
}

function CheckCircleIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13" cy="13" r="10" />
      <polyline points="8,13 11.5,16.5 18,9.5" />
    </svg>
  )
}

function LayersIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13,2 24,8 13,14 2,8" />
      <polyline points="2,14 13,20 24,14" />
      <polyline points="2,19 13,25 24,19" />
    </svg>
  )
}

const STEPS: Step[] = [
  {
    title: 'Extract Claims',
    description: 'Extract claims from research papers on Elicit, SciSpace, and Consensus. Open the sidebar while browsing these sites.',
    icon: <DocumentIcon />,
  },
  {
    title: 'Verify Claims',
    description: 'Review and verify claims across multiple sources. Identify which claims are supported by the research.',
    icon: <CheckCircleIcon />,
  },
  {
    title: 'Organize & Synthesize',
    description: 'Organize verified claims into projects and synthesize them into research documents.',
    icon: <LayersIcon />,
  },
]

interface OnboardingOverlayProps {
  onComplete: () => void
}

export function OnboardingOverlay({ onComplete }: OnboardingOverlayProps) {
  const [step, setStep] = useState(0)
  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(124,58,237,0.20)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="bg-[var(--rk-surface)] w-full max-w-md mx-4 overflow-hidden"
        style={{
          borderRadius: 16,
          border: '1px solid var(--rk-border-warm)',
          boxShadow: 'var(--rk-shadow-modal)',
        }}
      >
        <div className="p-6 text-center">
          {/* Step icon */}
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: 'var(--rk-brand-gradient)',
            boxShadow: '0 4px 12px rgba(124,58,237,0.35)',
            margin: '0 auto 12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {current.icon}
          </div>

          {/* Welcome subtitle on step 0 only */}
          {step === 0 && (
            <p style={{ fontSize: 11, color: 'var(--rk-text-3)', marginBottom: 4 }}>Welcome to ResearchKit</p>
          )}

          {/* Step label */}
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--rk-brand)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            STEP {step + 1} OF {STEPS.length}
          </p>

          {/* Step title */}
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--rk-text-brand)', marginBottom: 8 }}>{current.title}</h2>

          <p className="text-sm text-[var(--rk-text-3)] mb-6">{current.description}</p>

          {/* Progress dots */}
          <div className="flex items-center justify-center gap-1.5 mb-6">
            {STEPS.map((_, i) => (
              <div
                key={i}
                style={{
                  height: 6, borderRadius: 99,
                  transition: 'all 0.2s',
                  width: i === step ? 20 : 6,
                  background: i === step ? 'var(--rk-brand-gradient)' : 'var(--rk-border-warm)',
                }}
              />
            ))}
          </div>

          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                style={{
                  flex: 1, padding: '9px 16px', borderRadius: 10,
                  border: '1px solid var(--rk-border-warm)',
                  background: 'var(--rk-surface-warm)',
                  color: 'var(--rk-brand)',
                  fontSize: 13, fontWeight: 600,
                }}
              >
                Back
              </button>
            )}
            {!isLast && (
              <button
                onClick={() => setStep(step + 1)}
                style={{
                  flex: 1, padding: '9px 16px', borderRadius: 10,
                  background: 'var(--rk-brand-gradient)',
                  color: 'white',
                  fontSize: 13, fontWeight: 600,
                  boxShadow: '0 3px 10px rgba(124,58,237,0.35)',
                  border: 'none',
                }}
              >
                Next →
              </button>
            )}
            {isLast && (
              <button
                onClick={onComplete}
                style={{
                  flex: 1, padding: '9px 16px', borderRadius: 10,
                  background: 'var(--rk-brand-gradient)',
                  color: 'white',
                  fontSize: 13, fontWeight: 600,
                  boxShadow: '0 3px 10px rgba(124,58,237,0.35)',
                  border: 'none',
                }}
              >
                Get Started →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
