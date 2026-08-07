import type { Config } from 'tailwindcss';

const scale = (name: string) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => [step, `var(--${name}-${step})`]),
  );

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        foundation: scale('foundation'),
        memory: scale('memory'),
        consequence: scale('consequence'),
        canvas: 'var(--canvas)',
        surface: 'var(--surface)',
        'surface-muted': 'var(--surface-muted)',
        'surface-strong': 'var(--surface-strong)',
        border: { subtle: 'var(--border-subtle)', strong: 'var(--border-strong)' },
        text: {
          strong: 'var(--text-strong)',
          DEFAULT: 'var(--text)',
          muted: 'var(--text-muted)',
          disabled: 'var(--text-disabled)',
          inverse: 'var(--text-inverse)',
        },
        action: {
          DEFAULT: 'var(--action)',
          hover: 'var(--action-hover)',
          pressed: 'var(--action-pressed)',
          subtle: 'var(--action-subtle)',
          foreground: 'var(--on-action)',
        },
        success: { DEFAULT: 'var(--success)', bg: 'var(--success-bg)' },
        warning: { DEFAULT: 'var(--warning)', bg: 'var(--warning-bg)' },
        danger: { DEFAULT: 'var(--danger)', bg: 'var(--danger-bg)' },
        info: { DEFAULT: 'var(--info)', bg: 'var(--info-bg)' },
        chart: {
          1: 'var(--chart-1)',
          2: 'var(--chart-2)',
          3: 'var(--chart-3)',
          4: 'var(--chart-4)',
          5: 'var(--chart-5)',
          grid: 'var(--chart-grid)',
        },
        /* Temporary aliases used only by the existing placeholder. */
        brand: scale('brand'),
        gold: {
          400: 'var(--gold-400)',
          500: 'var(--gold-500)',
          600: 'var(--gold-600)',
          700: 'var(--gold-700)',
        },
        ink: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800].map((step) => [step, `var(--ink-${step})`]),
        ),
      },
      fontFamily: {
        display: ['"Source Serif 4"', '"Noto Naskh Arabic"', 'Georgia', 'serif'],
        sans: ['"IBM Plex Sans"', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        display: ['var(--text-display)', { lineHeight: 'var(--leading-display)' }],
        h1: ['var(--text-h1)', { lineHeight: 'var(--leading-heading)' }],
        h2: ['var(--text-h2)', { lineHeight: 'var(--leading-heading)' }],
        h3: ['var(--text-h3)', { lineHeight: 'var(--leading-heading)' }],
        'body-lg': ['var(--text-body-lg)', { lineHeight: 'var(--leading-body)' }],
        body: ['var(--text-body)', { lineHeight: 'var(--leading-body)' }],
        caption: ['var(--text-caption)', { lineHeight: '1.5' }],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      minHeight: { control: 'var(--control-height)', row: 'var(--row-height)' },
      maxWidth: { reading: 'var(--content-reading)', product: 'var(--content-product)' },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        'ring-focus': 'var(--ring-focus)',
        'ring-focus-danger': 'var(--ring-focus-danger)',
      },
      transitionDuration: {
        instant: 'var(--motion-instant)',
        fast: 'var(--motion-fast)',
        base: 'var(--motion-base)',
        slow: 'var(--motion-slow)',
        reveal: 'var(--motion-reveal)',
      },
      transitionTimingFunction: {
        enter: 'var(--ease-enter)',
        exit: 'var(--ease-exit)',
        standard: 'var(--ease-standard)',
      },
      zIndex: {
        dropdown: 'var(--z-dropdown)',
        sticky: 'var(--z-sticky)',
        header: 'var(--z-header)',
        overlay: 'var(--z-overlay)',
        modal: 'var(--z-modal)',
        toast: 'var(--z-toast)',
      },
    },
  },
  plugins: [],
} satisfies Config;
