function dateLabel() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

export const TEMPLATES = {
  meeting: {
    label: 'Meeting Notes',
    icon: '📋',
    color: 'cyan',
    title: () => `Meeting Notes — ${dateLabel()}`,
    content: () =>
`# Meeting Notes

**Date:** ${dateLabel()}
**Attendees:**

## Agenda

1.

## Discussion

## Action Items

- [ ]

## Notes

`,
  },

  daily: {
    label: 'Daily Journal',
    icon: '🌅',
    color: 'amber',
    title: () => `Daily Journal — ${dateLabel()}`,
    content: () =>
`# ${dateLabel()}

## Today's Focus

-

## Gratitude

-

## Reflections

`,
  },

  todo: {
    label: 'Todo List',
    icon: '✅',
    color: 'green',
    title: () => `Todo — ${dateLabel()}`,
    content: () =>
`# Todo List

## Must Do

- [ ]

## Should Do

- [ ]

## Nice To Have

- [ ]
`,
  },

  blank: {
    label: 'Blank Note',
    icon: '✦',
    color: 'violet',
    title: () => 'Untitled',
    content: () => '',
  },
};

export function applyTemplate(key) {
  const t = TEMPLATES[key] || TEMPLATES.blank;
  return {
    title:   t.title(),
    content: t.content(),
    color:   t.color,
    tags:    [key !== 'blank' ? key : ''].filter(Boolean),
  };
}
