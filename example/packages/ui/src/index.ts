// UI components that import from utils
import { capitalize, formatDate } from "@example/utils";

export function Button(text: string) {
	return `<button>${capitalize(text)}</button>`;
}

export function DateDisplay(date: Date) {
	return `<span>${formatDate(date)}</span>`;
}
