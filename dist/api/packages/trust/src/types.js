"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMPLICIT_NO_ACTION_REPEAT_DELTA = exports.REJECT_DELTA = exports.ACCEPT_DELTA = exports.DEFAULT_TRUST_BY_DOMAIN = void 0;
exports.DEFAULT_TRUST_BY_DOMAIN = {
    finance: 0.3,
    security: 0.3,
    agenda: 0.6,
    tasks: 0.6,
    messaging: 0.5,
    generic: 0.5,
};
exports.ACCEPT_DELTA = 0.1;
exports.REJECT_DELTA = -0.15;
exports.IMPLICIT_NO_ACTION_REPEAT_DELTA = -0.05;
