import { PLUGIN_ID } from '../config/constants';

const getTranslation = (id: string) => `${PLUGIN_ID}.${id}`;

export { getTranslation };
