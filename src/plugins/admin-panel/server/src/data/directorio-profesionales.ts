/**
 * Directorio de profesionales del derecho tributario — campaña de invitación
 * a la aplicación móvil (septiembre de 2026).
 *
 * POR QUÉ VIVE ACÁ Y NO EN LA BASE DE DATOS
 * -----------------------------------------
 * Son direcciones recopiladas fuera de la plataforma: ninguna de estas
 * personas tiene cuenta ni pidió una. Meterlas en `invited-email` las
 * convertiría en «invitadas» a los ojos del resto del sistema —entre otras
 * cosas entrarían en la audiencia del correo de lanzamiento— y habría que
 * excluirlas a mano en cada consulta. Como lista estática el alcance es
 * exactamente el de esta campaña y nada más.
 *
 * EL `id` ES ESTABLE Y SE USA PARA MEDIR
 * -------------------------------------
 * Viaja en el enlace de la tienda como `d=<id>` (ver el puente `/ir/...` de
 * la webapp). Permite saber después qué destinatario abrió la tienda sin
 * que el correo de la persona viaje nunca en una URL. Por eso NO se
 * reordena ni se reenumera esta lista: si se agregan direcciones, van al
 * final con el siguiente id libre.
 *
 * El `saludo` está escrito a mano uno por uno: Dr./Dra. con nombre donde se
 * conoce a la persona, «Estimado/a» donde no. No se deduce del nombre.
 */

export type ProfesionalDirectorio = {
  id: number;
  correo: string;
  saludo: string;
  /** Solo informativo para el panel; el correo usa `saludo`. */
  nombre: string;
};

export const CAMPANA_DIRECTORIO = 'directorio-2026-09';

export const DIRECTORIO_PROFESIONALES: ProfesionalDirectorio[] = [
  { id: 1, correo: "dizquierdo@izquierdoycastro.com", saludo: "Estimada Dra. María Denisse Izquierdo Castro", nombre: "María Denisse Izquierdo Castro" },
  { id: 2, correo: "djuliofabry_12@hotmail.com", saludo: "Estimado Dr. Julio Fabricio Acosta Lasso", nombre: "Julio Fabricio Acosta Lasso" },
  { id: 3, correo: "pame_aguirre@hotmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 4, correo: "malbanz@gmail.com", saludo: "Estimado Dr. Marco Albán", nombre: "Marco Albán" },
  { id: 5, correo: "d.alvarez@fileconsulting.ec", saludo: "Estimado/a", nombre: "" },
  { id: 6, correo: "jorgealvarezra@gmail.com", saludo: "Estimado Dr. Jorge Alvarez", nombre: "Jorge Alvarez" },
  { id: 7, correo: "karenas@stratos.ec", saludo: "Estimada Dra. Karilin Arenas", nombre: "Karilin Arenas" },
  { id: 8, correo: "parias@lexvalor.com", saludo: "Estimado/a", nombre: "" },
  { id: 9, correo: "ca_arosemena@hotmail.com", saludo: "Estimado Dr. Carlos Andrés Arosemena Ortega", nombre: "Carlos Andrés Arosemena Ortega" },
  { id: 10, correo: "cjbalseca@ccbabogados.com", saludo: "Estimado Dr. Carlos Julio Balseca Avila", nombre: "Carlos Julio Balseca Avila" },
  { id: 11, correo: "mlbch1974@yahoo.com", saludo: "Estimado/a", nombre: "" },
  { id: 12, correo: "dibonilla@ueb.edu.ec", saludo: "Estimado/a", nombre: "" },
  { id: 13, correo: "ebueno@abocacia.com", saludo: "Estimado Dr. Esteban Bueno", nombre: "Esteban Bueno" },
  { id: 14, correo: "raissa.aguila@andersentaxlegal.ec", saludo: "Estimada Dra. Raissa Aguila", nombre: "Raissa Aguila" },
  { id: 15, correo: "reginacardenasluzuriaga@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 16, correo: "romeocarpio@hotmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 17, correo: "Alexis.Carrera@ec.ey.com", saludo: "Estimado Dr. Alexis Carrera", nombre: "Alexis Carrera" },
  { id: 18, correo: "emcarrillo@almeidaguzman.com", saludo: "Estimado/a", nombre: "" },
  { id: 19, correo: "jecg6664@hotmail.com", saludo: "Estimada Dra. Estefania Carvajal", nombre: "Estefania Carvajal" },
  { id: 20, correo: "jcevallos@avl.com.ec", saludo: "Estimado/a", nombre: "" },
  { id: 21, correo: "janycollantes@hotmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 22, correo: "dicod_ec@me.com", saludo: "Estimado Dr. Diego Condo", nombre: "Diego Condo" },
  { id: 23, correo: "javier.cordero@cyabogados.ec", saludo: "Estimado/a", nombre: "" },
  { id: 24, correo: "ccoronel@lexvalor.com", saludo: "Estimado Dr. Carlos Coronel", nombre: "Carlos Coronel" },
  { id: 25, correo: "eddy.delaguerra@uasb.edu.ec", saludo: "Estimada Dra. Eddy de la Guerra", nombre: "Eddy de la Guerra" },
  { id: 26, correo: "douglastorresferaud@gmail.com", saludo: "Estimado Dr. Douglas Medardo Torres Feraud", nombre: "Douglas Medardo Torres Feraud" },
  { id: 27, correo: "mauricio.durango@andersentaxlegal.ec", saludo: "Estimado Dr. Mauricio Durango", nombre: "Mauricio Durango" },
  { id: 28, correo: "abogadosferrin@yahoo.com", saludo: "Estimado Dr. Carlos René Ferrín de la Torre", nombre: "Carlos René Ferrín de la Torre" },
  { id: 29, correo: "yael_david4@hotmail.com", saludo: "Estimada Dra. Yael Fierro Guillén", nombre: "Yael Fierro Guillén" },
  { id: 30, correo: "bolivar.figueroa@gmail.com", saludo: "Estimado Dr. Bolívar Figueroa M", nombre: "Bolívar Figueroa M" },
  { id: 31, correo: "gabrielgalan@legacy.com.ec", saludo: "Estimado/a", nombre: "" },
  { id: 32, correo: "galarragaluis@hotmail.com", saludo: "Estimado Dr. Luis Galarraga", nombre: "Luis Galarraga" },
  { id: 33, correo: "rodrigo_godoy1979@hotmail.es", saludo: "Estimado/a", nombre: "" },
  { id: 34, correo: "fgottifredi@gottifredipozo.com", saludo: "Estimado Dr. Francisco Gottifredi", nombre: "Francisco Gottifredi" },
  { id: 35, correo: "paulina.guerra@munoz-guerra.com", saludo: "Estimada Dra. Paulina Guerra", nombre: "Paulina Guerra" },
  { id: 36, correo: "pguevara@fides.ec", saludo: "Estimado/a", nombre: "" },
  { id: 37, correo: "jhidalgo1876@hotmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 38, correo: "fernandaingac@gmail.com", saludo: "Estimada Dra. Fernanda Inga", nombre: "Fernanda Inga" },
  { id: 39, correo: "kizquierdoc@izquierdoycastro.com", saludo: "Estimado Dr. Kléber Izquierdo Castro", nombre: "Kléber Izquierdo Castro" },
  { id: 40, correo: "mariagracianaranjo@gmail.com", saludo: "Estimada Dra. María Gracia Naranjo Ponce", nombre: "María Gracia Naranjo Ponce" },
  { id: 41, correo: "ficasesores@gmail.com", saludo: "Estimado Dr. Francisco Leon", nombre: "Francisco Leon" },
  { id: 42, correo: "joseluisloor@hotmail.com", saludo: "Estimado Dr. José Luis Loor Vivas", nombre: "José Luis Loor Vivas" },
  { id: 43, correo: "vicentemaldonado01@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 44, correo: "krmartinezy@hotmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 45, correo: "armejiasalazar@gmail.com", saludo: "Estimado Dr. Alvaro R. Mejía Salazar", nombre: "Alvaro R. Mejía Salazar" },
  { id: 46, correo: "egfelipemt@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 47, correo: "eminuche@hotmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 48, correo: "cesar.montano@uasb.edu.ec", saludo: "Estimado/a", nombre: "" },
  { id: 49, correo: "vmonterodecallejas@yahoo.es", saludo: "Estimado/a", nombre: "" },
  { id: 50, correo: "adrimora30@hotmail.com", saludo: "Estimada Dra. Adriana Mora Bernal", nombre: "Adriana Mora Bernal" },
  { id: 51, correo: "sol_moreno@live.com", saludo: "Estimado/a", nombre: "" },
  { id: 52, correo: "cmsanci@gmail.com", saludo: "Estimada Dra. Camila Moreno", nombre: "Camila Moreno" },
  { id: 53, correo: "pamemorilloj@gmail.com", saludo: "Estimada Dra. Pamela Morillo", nombre: "Pamela Morillo" },
  { id: 54, correo: "andrea_moya86@hotmail.com", saludo: "Estimada Dra. Andrea Moya", nombre: "Andrea Moya" },
  { id: 55, correo: "dnaranjo@almeidaguzman.com", saludo: "Estimado/a", nombre: "" },
  { id: 56, correo: "Mario.orellana@ec.andersen.com", saludo: "Estimado/a", nombre: "" },
  { id: 57, correo: "rovic49@yahoo.com", saludo: "Estimado Dr. Rodrigo Patino", nombre: "Rodrigo Patino" },
  { id: 58, correo: "juancarlos.penafiel@fbphlaw.com", saludo: "Estimado Dr. Juan Carlos Peñafiel", nombre: "Juan Carlos Peñafiel" },
  { id: 59, correo: "tatianaperez@hotmail.com", saludo: "Estimada Dra. Tatiana Perez", nombre: "Tatiana Perez" },
  { id: 60, correo: "racines.fernanda@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 61, correo: "francisco.ramos.franco@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 62, correo: "jreyes@pbplaw.com", saludo: "Estimado Dr. Juan Gabriel Reyes", nombre: "Juan Gabriel Reyes" },
  { id: 63, correo: "frites@integroec.com", saludo: "Estimado/a", nombre: "" },
  { id: 64, correo: "lorerivas90@hotmail.com", saludo: "Estimada Dra. María Lorena Rivadeneira V", nombre: "María Lorena Rivadeneira V" },
  { id: 65, correo: "probalino@ecija.com", saludo: "Estimada Dra. Paola Angélica Robalino Rosero", nombre: "Paola Angélica Robalino Rosero" },
  { id: 66, correo: "pablofron@gmail.com", saludo: "Estimado Dr. Pablo Ron", nombre: "Pablo Ron" },
  { id: 67, correo: "misael.ruiz.fierro@gmail.com", saludo: "Estimado Dr. Misael Ruiz", nombre: "Misael Ruiz" },
  { id: 68, correo: "mafersaa@bustamantefabara.com", saludo: "Estimado/a", nombre: "" },
  { id: 69, correo: "dsalazar@taxcomec.com", saludo: "Estimada Dra. Diana Salazar", nombre: "Diana Salazar" },
  { id: 70, correo: "santorogabriela@hotmail.com", saludo: "Estimada Dra. Gabriela Santoro", nombre: "Gabriela Santoro" },
  { id: 71, correo: "csimone@pbplaw.com", saludo: "Estimada Dra. Carmen Simone Lasso", nombre: "Carmen Simone Lasso" },
  { id: 72, correo: "jsoto@sototaxlaw.com", saludo: "Estimado/a", nombre: "" },
  { id: 73, correo: "paula_subia@hotmail.com", saludo: "Estimada Dra. Paula Subia", nombre: "Paula Subia" },
  { id: 74, correo: "jtamayo@tamayoabogados.com", saludo: "Estimado/a", nombre: "" },
  { id: 75, correo: "jostersua@hotmail.com", saludo: "Estimado Dr. José Luis Terán", nombre: "José Luis Terán" },
  { id: 76, correo: "tiberio.torres@ucuenca.edu.ec", saludo: "Estimado/a", nombre: "" },
  { id: 77, correo: "jorgeugarteq@gmail.com", saludo: "Estimado Dr. Jorge Ugarte", nombre: "Jorge Ugarte" },
  { id: 78, correo: "gabrielaui@gmail.com", saludo: "Estimada Dra. Gabriela Uquillas", nombre: "Gabriela Uquillas" },
  { id: 79, correo: "cinthia.uzcategui80@gmail.com", saludo: "Estimada Dra. Cinthia Uzcategui", nombre: "Cinthia Uzcategui" },
  { id: 80, correo: "gaby_valdivieso@hotmail.com", saludo: "Estimada Dra. Gabriela Judith Valdivieso Ortega", nombre: "Gabriela Judith Valdivieso Ortega" },
  { id: 81, correo: "karina_vb@hotmail.com", saludo: "Estimada Dra. Karina Vallejo", nombre: "Karina Vallejo" },
  { id: 82, correo: "svvsvv@hotmail.com", saludo: "Estimado Dr. Santiago Vallejo Vasquéz", nombre: "Santiago Vallejo Vasquéz" },
  { id: 83, correo: "dakar42@hotmail.com", saludo: "Estimado Dr. Darío Velástegui Enríquez", nombre: "Darío Velástegui Enríquez" },
  { id: 84, correo: "xavievolution@yahoo.com", saludo: "Estimado/a", nombre: "" },
  { id: 85, correo: "villegaslandazuri@gmail.com", saludo: "Estimado Dr. Pablo Villegas", nombre: "Pablo Villegas" },
  { id: 86, correo: "santiagovinuezavv@gmail.com", saludo: "Estimado Dr. Santiago Vinueza", nombre: "Santiago Vinueza" },
  { id: 87, correo: "avivanco@vac-law.com", saludo: "Estimado Dr. Alberto Vivanco", nombre: "Alberto Vivanco" },
  { id: 88, correo: "gvivar@fidesprofile.ec", saludo: "Estimado/a", nombre: "" },
  { id: 89, correo: "jyupa@deloitte.com", saludo: "Estimado Dr. Juan Yupa Robalino", nombre: "Juan Yupa Robalino" },
  { id: 90, correo: "yolitayupangui@hotmail.com", saludo: "Estimada Dra. Yolanda Yupangui", nombre: "Yolanda Yupangui" },
  { id: 91, correo: "gmaldonado7@hotmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 92, correo: "aguirre_max@hotmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 93, correo: "aelizalde@aeqtributarios.com", saludo: "Estimado/a", nombre: "" },
  { id: 94, correo: "jproanio@pbplaw.com", saludo: "Estimado/a", nombre: "" },
  { id: 95, correo: "danielaescobarbeltran@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 96, correo: "tjaramillo76@yahoo.es", saludo: "Estimado/a", nombre: "" },
  { id: 97, correo: "pcvaldivieso@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 98, correo: "abg_fernando_andrade@yahoo.com", saludo: "Estimado/a", nombre: "" },
  { id: 99, correo: "aizquierdot@gmail.com", saludo: "Estimada Dra. Anita Izquierdo", nombre: "Anita Izquierdo" },
  { id: 100, correo: "ju.sanchez.ec@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 101, correo: "aespinosa047@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 102, correo: "cindyelizabethvivar@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 103, correo: "bchavezloor@gmail.com", saludo: "Estimada Dra. María Belén Chávez", nombre: "María Belén Chávez" },
  { id: 104, correo: "businesscontact@sototaxlaw.com", saludo: "Estimado/a", nombre: "" },
  { id: 105, correo: "anabelmedinadiaz@gmail.com", saludo: "Estimada Dra. Anabel Medina", nombre: "Anabel Medina" },
  { id: 106, correo: "cavvlegal@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 107, correo: "jpazmino93@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 108, correo: "elizabeth.grijalva@pwc.com", saludo: "Estimada Dra. ELIZABETH Grijalva", nombre: "ELIZABETH Grijalva" },
  { id: 109, correo: "idrian@estrella-apolo-consultores.com", saludo: "Estimado/a", nombre: "" },
  { id: 110, correo: "cristina.trujillo@tcaudit.com.ec", saludo: "Estimado/a", nombre: "" },
  { id: 111, correo: "carlos_marin19@hotmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 112, correo: "mbernarda.carpio@gmail.com", saludo: "Estimada Dra. Maria Bernarda Carpio Frixone", nombre: "Maria Bernarda Carpio Frixone" },
  { id: 113, correo: "raulcolmont@impostaec.com", saludo: "Estimado/a", nombre: "" },
  { id: 114, correo: "alvaro.cardenas@cognuz.com", saludo: "Estimado/a", nombre: "" },
  { id: 115, correo: "cpazmino@destraconsultores.com", saludo: "Estimado/a", nombre: "" },
  { id: 116, correo: "Slarrea@pbplaw.com", saludo: "Estimado/a", nombre: "" },
  { id: 117, correo: "rodasmanolo@hotmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 118, correo: "sandro_vallejo@yahoo.com.mx", saludo: "Estimado Dr. Sandro Vallejo", nombre: "Sandro Vallejo" },
  { id: 119, correo: "gvasquez@impuestosecuador.com.ec", saludo: "Estimado/a", nombre: "" },
  { id: 120, correo: "miguezumba1@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 121, correo: "caromedina97@outlook.com", saludo: "Estimado/a", nombre: "" },
  { id: 122, correo: "dpino@bustamantefabara.com", saludo: "Estimado Dr. Diego Pino", nombre: "Diego Pino" },
  { id: 123, correo: "sofygordillo@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 124, correo: "emilioveint@hotmail.fr", saludo: "Estimado/a", nombre: "" },
  { id: 125, correo: "safecontec@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 126, correo: "fhcebeto@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 127, correo: "dfgavilanes1@hotmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 128, correo: "milalvawilchesa@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 129, correo: "xav_tor@live.com", saludo: "Estimado Dr. Xavier Torres", nombre: "Xavier Torres" },
  { id: 130, correo: "jcarrasco@pbplaw.com", saludo: "Estimado/a", nombre: "" },
  { id: 131, correo: "eaparedes2@outlook.com", saludo: "Estimado/a", nombre: "" },
  { id: 132, correo: "karenas@tpconsulting-group.com", saludo: "Estimado/a", nombre: "" },
  { id: 133, correo: "mayra.leon.ec@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 134, correo: "patriciam@deiurecorp.com", saludo: "Estimado/a", nombre: "" },
  { id: 135, correo: "yuyamn@hotmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 136, correo: "portegar@gallinoti.com", saludo: "Estimado/a", nombre: "" },
  { id: 137, correo: "jpenafiel@redlegalyasociados.com", saludo: "Estimado/a", nombre: "" },
  { id: 138, correo: "paorobalino@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 139, correo: "jsoto@deloitte.com", saludo: "Estimado/a", nombre: "" },
  { id: 140, correo: "bfigueroa@robalinolaw.com", saludo: "Estimado/a", nombre: "" },
  { id: 141, correo: "jhidalgo@auditcorporate.com", saludo: "Estimado/a", nombre: "" },
  { id: 142, correo: "eminuche@ltconsultores.es", saludo: "Estimado/a", nombre: "" },
  { id: 143, correo: "portega@sempertegui.com", saludo: "Estimado/a", nombre: "" },
  { id: 144, correo: "eaparedes2@gmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 145, correo: "paula_subia@icloud.com", saludo: "Estimado/a", nombre: "" },
  { id: 146, correo: "villegaslandazuri@hotmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 147, correo: "alopez@cevallosnoboa.com", saludo: "Estimado Dr. Andrés López", nombre: "Andrés López" },
  { id: 148, correo: "ipatino@gottifredipozo.com", saludo: "Estimado/a", nombre: "" },
  { id: 149, correo: "fabian.romero@ucacue.edu.ec", saludo: "Estimado/a", nombre: "" },
  { id: 150, correo: "dcondo@uazuay.edu.ec", saludo: "Estimado/a", nombre: "" },
  { id: 151, correo: "bbarrera@uazuay.edu.ec", saludo: "Estimado/a", nombre: "" },
  { id: 152, correo: "pacomoscoso@hotmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 153, correo: "cleonacosta@kascla.com", saludo: "Estimado/a", nombre: "" },
  { id: 154, correo: "jaimeordonez4@hotmail.com", saludo: "Estimado Dr. Jaime Ordonez", nombre: "Jaime Ordonez" },
  { id: 155, correo: "fpacheco@gvazquez.com.ec", saludo: "Estimado/a", nombre: "" },
  { id: 156, correo: "oyervide@hotmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 157, correo: "armando.lana@codex.com.ec", saludo: "Estimado/a", nombre: "" },
  { id: 158, correo: "guillermotogra@hotmail.com", saludo: "Estimado/a", nombre: "" },
  { id: 159, correo: "luisfelipejaramillo@yahoo.com", saludo: "Estimado/a", nombre: "" },

  /*
   * JUECES — agregados el 18 de septiembre de 2026, a pedido de John.
   *
   * Son magistrados en ejercicio, no litigantes: leen la jurisprudencia que
   * ellos mismos producen. Van en esta lista y no en la audiencia del correo
   * de lanzamiento porque ninguno tiene cuenta en la plataforma.
   *
   * Marco Albán NO se repite acá: ya estaba en el directorio con el id 4, y
   * esta lista no se deduplica sola —una segunda fila con el mismo correo
   * significaría dos correos a la misma persona—.
   */
  // Corte Nacional de Justicia
  { id: 160, correo: "gilda.morales@cortenacional.gob.ec", saludo: "Estimada Dra. Rossana Morales", nombre: "Rossana Morales" },
  { id: 161, correo: "jdsuing@gmail.com", saludo: "Estimado Dr. José Suing", nombre: "José Suing" },
  { id: 162, correo: "gustavodurangovela@hotmail.com", saludo: "Estimado Dr. Gustavo Durango", nombre: "Gustavo Durango" },
  // Judicatura de Pichincha
  { id: 163, correo: "paul_rengel2003@hotmail.com", saludo: "Estimado Dr. Paul Rengel", nombre: "Paul Rengel" },
  { id: 164, correo: "mnc.heredia@yahoo.com", saludo: "Estimada Dra. Mónica Heredia", nombre: "Mónica Heredia" },
];
