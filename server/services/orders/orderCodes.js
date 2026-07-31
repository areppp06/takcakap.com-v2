/**
 * Order short-code generation (AAA-001 style).
 */
'use strict';

const incrementPrefix = (prefix) => {
    const chars = prefix.split('');
    for (let i = chars.length - 1; i >= 0; i--) {
        const charCode = chars[i].charCodeAt(0);
        if (charCode < 90) {
            // 'Z' is 90
            chars[i] = String.fromCharCode(charCode + 1);
            break;
        } else {
            chars[i] = 'A';
        }
    }
    return chars.join('');
};

const getNextOrderCode = (lastCode) => {
    if (!lastCode) return 'AAA-001';
    const parts = lastCode.split('-');
    let prefix = parts[0];
    let num = parseInt(parts[1], 10);

    num += 1;
    if (num > 999) {
        num = 1;
        prefix = incrementPrefix(prefix);
    }

    const paddedNum = String(num).padStart(3, '0');
    return `${prefix}-${paddedNum}`;
};

module.exports = {
    incrementPrefix,
    getNextOrderCode
};
