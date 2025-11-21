// UI components that import from utils
import { capitalize, formatDate } from '@example/utils';
export function Button(text) {
    return `<button>${capitalize(text)}</button>`;
}
export function DateDisplay(date) {
    return `<span>${formatDate(date)}</span>`;
}
//# sourceMappingURL=index.js.map