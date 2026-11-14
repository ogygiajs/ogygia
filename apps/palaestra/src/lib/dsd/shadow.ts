/** A `<x-card>`'s server render: a declarative shadow root that shows `label` and slots the light DOM. */
export function card_shadow(label: string): string {
	return `<template shadowrootmode="open"><x-badge>${label}</x-badge><slot></slot></template>`;
}
