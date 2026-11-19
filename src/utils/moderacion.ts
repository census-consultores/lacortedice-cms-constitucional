/**
 * Filtro de contenido del Debate Tributario.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 * ─────────────────────────────────────────────────────────────────────
 * La guía 1.2 de Apple exige, para cualquier app con contenido de usuarios,
 * "un método para FILTRAR el material objetable antes de que se publique".
 * Hasta ahora la moderación era solo reactiva (denuncia → un admin entra a la
 * cola), lo que no cumple ese punto y además deja el contenido visible
 * mientras nadie mira.
 *
 * El filtro es deliberadamente conservador: el Debate es de abogados
 * tributarios discutiendo sentencias, y el costo de un falso positivo (un
 * comentario legítimo bloqueado) es alto. Por eso hay dos niveles:
 *
 *   · BLOQUEAR — insultos y ataques explícitos, discurso de odio, amenazas,
 *     contenido sexual, y datos de contacto masivos (spam). No se publica.
 *   · REVISAR  — la publicación sale, pero entra a la cola de moderación con
 *     una denuncia automática para que un admin la mire.
 *
 * Se normaliza el texto antes de comparar (minúsculas, sin tildes y con los
 * disfraces típicos: 0→o, 1→i, 3→e, @→a, $→s) para que "p3nd3j0" no pase.
 */

/** Normaliza para comparar: sin tildes, sin disfraces numéricos, minúsculas. */
export function normalizar(texto: string): string {
	return String(texto ?? '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[0@]/g, 'o')
		.replace(/[1!|]/g, 'i')
		.replace(/3/g, 'e')
		.replace(/4/g, 'a')
		.replace(/5\$/g, 's')
		.replace(/\$/g, 's')
		.replace(/7/g, 't')
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Términos que NO se publican. Lista corta y explícita: insultos personales
 * de uso común en Ecuador y la región, discurso de odio y amenazas. No se
 * incluyen palabras que en materia tributaria son legítimas ("defraudación",
 * "evasión", "delito", "fraude", "culpable", "dolo").
 */
const BLOQUEAR = [
	// Insultos y ataques personales
	'hijo de puta', 'hijueputa', 'hdp', 'malparido', 'pendejo', 'pendeja',
	'imbecil', 'estupido', 'estupida', 'idiota', 'tarado', 'retrasado',
	'mongolico', 'subnormal', 'gilipollas', 'cabron', 'conchatumadre',
	'chucha tu madre', 'verga', 'mierda', 'puta', 'puto', 'zorra', 'maricon',
	'joto', 'trolo',
	// Odio y discriminación
	'negro de mierda', 'indio de mierda', 'longo', 'cholo de mierda',
	'sudaca', 'judio de mierda', 'nazi de mierda',
	// Amenazas
	'te voy a matar', 'voy a matarte', 'te mato', 'ojala te mueras',
	'deberian matarlo', 'deberian matarla',
	// Sexual explícito
	'porno', 'xxx', 'sexo gratis', 'nudes'
];

/**
 * Términos que dejan pasar la publicación pero la mandan a revisión: nada de
 * esto es necesariamente una infracción, pero sí lo es a menudo.
 */
const REVISAR = [
	'estafador', 'ladron', 'ladrona', 'corrupto', 'corrupta', 'coimero',
	'sinverguenza', 'incompetente', 'ignorante', 'mentiroso', 'mentirosa',
	'vendido', 'comprado'
];

/** Señales de spam: contacto repetido, enlaces múltiples, mayúsculas gritadas. */
function pareceSpam(original: string): boolean {
	const enlaces = (original.match(/https?:\/\//gi) ?? []).length;
	if (enlaces >= 3) return true;
	// Teléfono o WhatsApp junto a una oferta.
	if (/\b(whatsapp|wasap|wsp)\b/i.test(original) && /\d{7,}/.test(original)) return true;
	// Grito sostenido: más del 70 % en mayúsculas en un texto largo.
	const letras = original.replace(/[^a-zA-ZÁÉÍÓÚÑáéíóúñ]/g, '');
	if (letras.length > 40) {
		const mayus = letras.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').length;
		if (mayus / letras.length > 0.7) return true;
	}
	return false;
}

/**
 * ¿Aparece `termino` en `texto` como PALABRA, no como pedazo de otra?
 *
 * Antes se comparaba con `texto.includes(termino)` y eso rompía el foro:
 * «puto» bloqueaba «cómputo» — y «el cómputo del plazo de caducidad» es
 * probablemente la frase más frecuente del contencioso tributario
 * ecuatoriano —; «puta» bloqueaba «reputación», «diputado» y «computar»;
 * «longo» bloqueaba «prolongó». Un revisor de Apple que abra un hilo y
 * escriba cualquiera de esas frases ve el filtro rechazar algo inocente.
 *
 * Se exige frontera a ambos lados y se admite el plural (-s / -es) para
 * que pluralizar no sea una vía de evasión. Los términos de varias
 * palabras funcionan igual: `normalizar` convierte toda la puntuación en
 * espacios, así que la frase queda separada por espacios simples.
 */
function coincidePalabra(texto: string, termino: string): boolean {
	const t = normalizar(termino);
	if (!t) return false;
	return new RegExp(`(?:^|\\s)${t}(?:s|es)?(?=\\s|$)`).test(texto);
}

export type Veredicto =
	| { accion: 'publicar' }
	| { accion: 'revisar'; motivo: string }
	| { accion: 'bloquear'; motivo: string; mensaje: string };

/**
 * Revisa un texto que se va a publicar en el Debate.
 * `titulo` es opcional (los comentarios no lo tienen).
 */
export function revisarContenido(cuerpo: string, titulo = ''): Veredicto {
	const original = `${titulo} ${cuerpo}`.trim();
	const texto = normalizar(original);

	for (const t of BLOQUEAR) {
		if (coincidePalabra(texto, t)) {
			return {
				accion: 'bloquear',
				motivo: `término prohibido: ${t}`,
				mensaje:
					'Tu publicación no se envió: contiene lenguaje ofensivo. El Debate es un espacio ' +
					'profesional — critica el criterio, no a la persona.'
			};
		}
	}

	if (pareceSpam(original)) {
		return {
			accion: 'bloquear',
			motivo: 'spam (enlaces/contacto/mayúsculas)',
			mensaje:
				'Tu publicación no se envió: parece publicidad. El Debate es para discutir sentencias ' +
				'y reformas, no para promocionar servicios.'
		};
	}

	for (const t of REVISAR) {
		if (coincidePalabra(texto, t)) {
			return { accion: 'revisar', motivo: `término sensible: ${t}` };
		}
	}

	return { accion: 'publicar' };
}
