require('dotenv').config();
const OpenAI = require('openai');
const express = require("express");
const sql = require("mssql");
const jwt = require('jsonwebtoken');
const cors = require("cors");
const fs = require("fs"); 
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- Configuración General ---
const PORT = process.env.PORT || 3001;
const JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';
const JWT_EXPIRES_IN = '24h';
// Asegúrate de que este archivo existe y la exportación es correcta:
const sqlConfig = require("./config"); 
const app = express();

// --- Configuración de IA (OpenAI) ---
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// --- Configuración de IA (Google Gemini) ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error("❌ ERROR CRÍTICO: La variable GEMINI_API_KEY no está definida en .env.");
    // No salimos, permitimos que los endpoints SQL funcionen
}
// Solo se inicializa si la clave existe
const ai = GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// 🔑 CONFIGURACIÓN BASE DEL MODELO GEMINI 
const baseModelConfig = {
    model: "gemini-2.5-flash",
    config: {
        temperature: 0.1,
        // Configuración de Seguridad para deshabilitar los filtros
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        ],
    }
};

// Esquema JSON para la extracción de datos
const documentExtractionSchema = {
    type: "object",
    properties: {
        // --- INFORMACIÓN CLAVE DEL DOCUMENTO ---
        invoice_number: { type: "string", description: "Número de Factura (Invoice Number)."},
        invoice_date: { type: "string", description: "Fecha de la Factura (Invoice Date) en formato YYYY-MM-DD. Si no es un formato de fecha válido, devuelve 'N/A'."},
        po_number: { type: "string", description: "Número de Orden de Compra (PO Number). Si no existe, devuelve una cadena vacía."},
        // --- DATOS DE MONTO Y PESO ---
        currency: { type: "string", description: "Moneda utilizada (ej. USD, MXN, EUR)."},
        subtotal_amount: { type: "number", description: "El monto subtotal de la Factura (antes de impuestos/cargos). Si no existe, devuelve 0."},
        tax_amount: { type: "number", description: "El monto total de impuestos (Tax Amount). Si no existe, devuelve 0."},
        total_amount: { type: "number", description: "El monto total final de la Factura (Invoice Amount) en números."},
        total_gross_weight_kg: { type: "number", description: "El peso bruto total (Gross Weight) en kilogramos (KG). Si solo hay peso en LB, convertirlo a KG (1 lb = 0.453592 kg) y devolverlo aquí."},
        // --- INFORMACIÓN DE ENTIDADES ---
        vendor_name: { type: "string", description: "Nombre completo de la entidad que emite la factura (Proveedor/Vendedor)."},
        vendor_tax_id: { type: "string", description: "Número de identificación fiscal o RFC del proveedor."},
        sold_to_id: { type: "string", description: "El ID de la entidad 'SOLD TO' (ej. P3621 ID:)."},
        // --- DETALLE DE PRODUCTOS (ARRAY) ---
        products: { 
            type: "array",
            description: "Lista de todos los productos o servicios detallados en las líneas de la factura. Si no hay líneas de producto, devuelve un array vacío (ej. []).",
            items: {
                type: "object",
                properties: {
                    item_sku: { type: "string", description: "SKU o número de parte del producto."},
                    item_description: { type: "string", description: "Descripción completa del producto o servicio."},
                    item_quantity: { type: "number", description: "Cantidad de unidades."},
                    item_unit_price: { type: "number", description: "Precio unitario (sin impuestos)."},
                    item_line_total: { type: "number", description: "Total de la línea (Cantidad * Precio Unitario)."}
                },
                required: ["item_description", "item_quantity", "item_line_total"]
            }
        },
        // --- OBSERVACIONES ---
        observaciones_ia: { type: "string", description: "Observación sobre la legibilidad del documento (ej. 'Documento escaneado y claro', 'Algunos campos están borrosos')."}
    },
    // Definimos solo los campos más importantes como estrictamente necesarios para forzar una respuesta
    required: ["invoice_number", "invoice_date", "currency", "total_amount", "vendor_name", "products"]
};

const documentExtractionSchema_SP = {
    // La raíz del esquema debe ser un objeto
    type: "object", 
    // Las propiedades del objeto
    properties: {
        // --- INFORMACIÓN CLAVE DEL DOCUMENTO ---
        numero_factura: { type: "string", description: "Número de Factura."},
        uuid: { type: "string", description: "Identificador Fiscal Unico."},
        fecha_factura: { type: "string", description: "Fecha de la Factura en formato YYYY-MM-DD. Si no es un formato de fecha válido, devuelve 'N/A'."},
        numero_orden_compra: { type: "string", description: "Número de Orden de Compra (PO Number). Si no existe, devuelve una cadena vacía."},
        metodo_pago: { type: "string", description: "Método de Pago utilizado en la Factura."},
        forma_pago: { type: "string", description: "Forma de Pago utilizada en la Factura."},
        tasa_iva: { type: "number", description: "Tasa de IVA aplicada en la Factura."},
        
        // --- DATOS DE MONTO Y PESO ---
        moneda: { type: "string", description: "Moneda utilizada (ej. USD, MXN, EUR)."},
        subtotal: { type: "number", description: "El monto subtotal de la Factura (antes de impuestos/cargos). Si no existe, devuelve 0."},
        impuesto: { type: "number", description: "El monto total de impuestos (Tax Amount). Si no existe, devuelve 0."},
        total: { type: "number", description: "El monto total final de la Factura (Invoice Amount) en números."},
        
        // --- INFORMACIÓN DE ENTIDADES (Corrección en RFC Receptor) ---
        nombre_emisor: { type: "string", description: "Nombre completo de la entidad que emite la factura (Proveedor/Vendedor)."},
        rfc_emisor: { type: "string", description: "RFC del proveedor."},
        domicilio_emisor: { type: "string", description: "Domicilio completo del emisor."},
        regimen_fiscal_emisor: { type: "string", description: "Clave y Regimen fiscal del emisor."},
        nombre_receptor: { type: "string", description: "Nombre completo de la entidad que recibe solicita la factura (cliente)."},
        // ✅ CORREGIDO: rfc_receptos -> rfc_receptor
        rfc_receptor: { type: "string", description: "RFC del cliente/receptor."}, 
        domicilio_receptor: { type: "string", description: "Domicilio completo del receptor."},
        regimen_fiscal_receptor: { type: "string", description: "Clave y Regimen fiscal del receptor."},
        
        // --- DETALLE DE PRODUCTOS (ARRAY) ---
        productos: { 
            type: "array",
            // ✅ CORRECCIÓN: Se usa 'description' en lugar de 'descripcion'
            description: "Lista de todos los productos o servicios detallados en las líneas de la factura. Si no hay líneas de producto, devuelve un array vacío (ej. []).",
            items: {
                type: "object",
                properties: {
                    sku: { type: "string", description: "SKU o número de parte del producto."},
                    clave_producto: { type: "string", description: "Clave del producto o servicio."},
                    clave_unidad: { type: "string", description: "Clave de la unidad de medida."},
                    unidad_medida: { type: "string", description: "Unidad de medida del producto."},
                    descripcion: { type: "string", description: "Descripción completa del producto o servicio."},
                    cantidad: { type: "number", description: "Cantidad de unidades."},
                    precio_unitario: { type: "number", description: "Precio unitario (sin impuestos)."},
                    importe: { type: "number", description: "Total de la línea (Cantidad * Precio Unitario)."}
                },
                required: ["descripcion", "cantidad", "importe"]
            }
        },
        
        // --- OBSERVACIONES ---
        observaciones_ia: { type: "string", description: "Observación sobre la legibilidad del documento (ej. 'Documento escaneado y claro', 'Algunos campos están borrosos')."}
    },
    // Definimos solo los campos más importantes como estrictamente necesarios para forzar una respuesta
    required: ["numero_factura", "uuid", "moneda", "total", "rfc_emisor", "productos"]
};

// --- Función Auxiliar para Parámetros SQL (CORRECCIÓN FINAL AGRESIVA DE ESPACIOS Y COMILLAS EXTERNAS) ---
function formatSqlParams(parametros) {
    let stringParametros = "";
    if (!parametros || typeof parametros !== 'object') {
        return "";
    }
    
    // DEBUG LOG: Ver los parámetros de entrada brutos antes de procesar
    console.log("[DEBUG] Raw Input Parameters:", JSON.stringify(parametros));

    for (let key in parametros) {
        if (!parametros.hasOwnProperty(key)) continue;

        const value = parametros[key];
        let quotedValue;
        
        let rawStringValue = value;
        if (typeof value === 'string' || value instanceof String) {
            // Trim normal de espacios normales al inicio/fin (ej: '  hola  ' -> 'hola')
            rawStringValue = value.trim(); 
            
            // *** SOLUCIÓN CRÍTICA: Detectar y remover comillas externas innecesarias ***
            // Esto maneja el caso donde el cliente envía '  369' ya envuelto en comillas.
            if (rawStringValue.startsWith("'") && rawStringValue.endsWith("'")) {
                // Elimina la primera y la última comilla.
                // Luego hace un trim adicional para limpiar cualquier espacio (incluyendo los invisibles) entre las comillas y el valor.
                rawStringValue = rawStringValue.substring(1, rawStringValue.length - 1).trim(); 
            }
        }

        // 1. TRATAMIENTO DE NÚMEROS: 
        // Eliminamos agresivamente CUALQUIER espacio (normales, invisibles \uFEFF, non-breaking \xA0)
        let cleanedNumericTest = (typeof rawStringValue === 'string') 
            ? rawStringValue.replace(/[\s\uFEFF\xA0]+/g, '') 
            : rawStringValue;

        // VERIFICACIÓN DE ENTERO PURO: Solo si la cadena restante es puramente dígitos (sin punto decimal).
        // Esto previene que una cadena con cualquier cosa que no sea un dígito sea tratada como número.
        const isPureInteger = typeof cleanedNumericTest === 'string' && /^\d+$/.test(cleanedNumericTest);

        if (isPureInteger) {
            // Es un número entero válido (ej. "369"), pasarlo sin comillas.
            quotedValue = cleanedNumericTest; 
            
        } else if (typeof rawStringValue === 'string' || rawStringValue instanceof String) {
            // 2. TRATAMIENTO DE CADENAS (ej. 'Trazabilidad de Pagos')
            // Se usa el valor con el trim normal (rawStringValue) y se envuelve en comillas, escapando comillas internas.
            quotedValue = `'${rawStringValue.replace(/'/g, "''")}'`; 
            
        } else {
            // 3. Otros tipos (números ya como number, booleanos, null)
            quotedValue = rawStringValue;
        }

        if (stringParametros.length > 0) stringParametros += ", ";
        
        // Comprobar si es un parámetro con nombre (@param) o posicional
        if (key.startsWith("@")) {
            stringParametros += `${key}=${quotedValue}`; 
        } else {
            stringParametros += `${quotedValue}`;
        }
    }
    
    // DEBUG LOG: Ver el query final después de procesar
    console.log("[DEBUG] Formatted SQL Parameters:", stringParametros);

    return stringParametros;
}


// --- Middlewares ---
app.use(express.json({ limit: '50mb' }));
app.use(cors());


// --- Endpoints de Conexión y Autenticación ---

app.get("/", async (req, res) => {
    try {
        await sql.connect(sqlConfig);
        // Prueba de conexión simple
        const result = await sql.query("SELECT GETDATE() as CurrentDateTime");
        res.send("✅ DB connection successful: " + JSON.stringify(result.recordset));
    } catch (err) {
        console.error(err);
        res.status(500).send("❌ DB connection failed: " + err.message);
    }
});

// Endpoint de login
app.post('/user/login', async (req, res) => {
    console.log("Login attempt received");
    try {
        const { email: usuarioInput } = req.body; 

        if (!usuarioInput) {
            return res.status(400).json({ success: false, message: 'Usuario is required' });
        }

        await sql.connect(sqlConfig);
        const result = await sql.query(`valida_usuario '${usuarioInput}'`); // Parámetro de string entre comillas

        if (!result.recordset || result.recordset.length === 0 || result.recordset[0].vigencia !== 'Válido') {
            return res.status(401).json({ success: false, message: 'User not found or not active' });
        }
        // ... (resto de la lógica de login)
        const user = result.recordset[0];
        let menu = [];
        if (result.recordsets[1] && result.recordsets[1][0]) {
            const jsonString = Object.values(result.recordsets[1][0])[0]; 
            const parsed = JSON.parse(jsonString);
            menu = parsed.Menu || [];
        }

        const serviceToken = jwt.sign(
            { id: user.usuario, email: user.usuario, name: user.nombre_persona, role: 'user', sucursal: user.sucursal, sucursalName: user.nombre_sucursal, id_persona: user.id_persona },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        return res.json({
            serviceToken,
            user: {
                id: user.usuario,
                name: user.nombre_persona,
                email: user.usuario,
                role: 'user',
                sucursal: user.sucursal,
                sucursalName: user.nombre_sucursal,
                id_persona: user.id_persona
            },
            menu 
        });

    } catch (err) {
        console.error('Error during login:', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Endpoint de refresh token (/user/cuenta/yo)
app.post('/user/cuenta/yo', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        await sql.connect(sqlConfig);
        const result = await sql.query(`valida_usuario '${decoded.email}'`);

        if (result.recordset.length === 0) {
            return res.status(401).json({ message: 'User not found' });
        }

        const user = result.recordset[0];
        let menu = [];
        if (result.recordsets[1] && result.recordsets[1][0]) {
            const jsonString = Object.values(result.recordsets[1][0])[0];
            const parsed = JSON.parse(jsonString);
            menu = parsed.Menu || [];
        }

        return res.json({
            user: {
                id: user.usuario,
                name: user.nombre_persona,
                email: user.usuario,
                role: 'user',
                sucursal: user.sucursal,
                sucursalName: user.nombre_sucursal,
                id_persona: user.id_persona
            },
            menu 
        });
    } catch (err) {
        console.error('Error in /user/cuenta/yo:', err);
        return res.status(401).json({ message: 'Invalid token' });
    }
});

// --- Endpoints de SQL Dinámicos (APLICANDO CORRECCIÓN DE TIPOS) ---

//Componente lista dinamico
app.post("/dinamico/lista", async (req, res) => {
  try {
    const { instruccionSQL, parametros } = req.body;
    console.log(instruccionSQL);
    console.log("parametros recibidos",parametros);

    // Validar instruccionSQL
    // const allowedInstructions = [
    //   "combo_tasas_ivas",
    //   "combo_sucursales",
    //   "combo_formas_pago",
    //   "Ser_Tramites_Aduanales"
    //   "Trae_Tramite_Aduanal"
    // ];
    // if (!allowedInstructions.includes(instruccionSQL)) {
    //   return res.status(400).json({ error: "Invalid SQL instruction" });
    // }

    // //Iterar sobre los parametros entrantes y crear un nuevo string
    // let instruccionSQLConParametros = ""

    // instruccionSQLConParametros = instruccionSQL

    // Build parameter string

    if(instruccionSQL == "Trae_Tramite_Aduanal"){
      let numberFolio = Number(parametros)
      console.log("NUMBER FOLIO", numberFolio, typeof numberFolio)

      //Intentar conectarse a la BD
    await sql.connect(sqlConfig);

      //Consulta con instruccionSQL y numbero de folio
    const result = await sql.query(`${instruccionSQL} ${numberFolio}`);

    console.log(result.recordsets)
    //Respuesta enviada
    res.status(200).json(result.recordsets);
    return 
    }

    let stringParametros = "";
    for (let key in parametros) {
      const value = parametros[key];
      if (stringParametros.length > 0) stringParametros += ", ";
      console.log(typeof value)
      console.log(value)
      console.log(key)
      console.log(typeof key)
      if(key.startsWith("@")){
        console.log("it starts with @")
        stringParametros += `${key}=${value}`; // "@cCentro='      1'"
      }else{
        stringParametros += `${value}`
      }

    }

    console.log("instruccionSQL", instruccionSQL);
    console.log("stringParametros", stringParametros);
    console.log(`${instruccionSQL}  ${stringParametros}`);

    //Intentar conectarse a la BD
    await sql.connect(sqlConfig);
// Ser_Tramites_Aduanales  '      1', '%', '2025-07-22', '2025-08-03', null
// Ser_Tramites_Aduanales  '      1', '%', '2025-08-01', '2025-08-07', null



    // const result = await sql.query(`${instruccionSQL} "${parametro1}" `);
    // const result = await sql.query(`${instruccionSQL} "${parametros}" `);
    // const result = await sql.query(`combo_tasas_ivas @lOtros=0, @lSolo_Activas=0`);

    // const result = await sql.query(`Ser_Tramites_Aduanales '      1', '%', '2025-06-01', '2025-08-01', null`);
 const result = await sql.query(`${instruccionSQL} ${stringParametros}`);

  // combo_sucursales  @cCentro=      1
  // combo_sucursales  @cCentro=      1
  console.log(result);

    res.status(200).json(result.recordsets);
  } catch (error) {
    console.error("Error al intentar obtener lista dinamica", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Endpoint de consulta general (consulta)
app.post("/consulta", async (req, res) => {
  // const { Consulta, Otros, Solo_Activas } = req.body;
  console.log(req.body);
  console.log(req.body.Procedimiento);
  let procedimiento = req.body.Procedimiento;
  let parametros = req.body.Parametros;

  //   for (let clave in req.body.Parametros) {
  //   console.log(req.body.Parametro[clave]);
  // }

  let parametrosConcatenados = "";

  // for (let valor of Object.values(req.body.Parametros)) {
  //   console.log(valor);
  //   parametrosConcatenados += valor + ',';
  // }

  for (let valor of Object.values(parametros)) {
    console.log("a");
    // console.log(a)
    parametrosConcatenados = parametrosConcatenados + valor + ",";
  }

  console.log(parametrosConcatenados);
  let parametrosListos = parametrosConcatenados.slice(0, -1);
  console.log(parametrosListos);

  let consulta = `${procedimiento} ${parametrosListos}`;
  console.log(consulta);

  // if (!Consulta || !Otros || !Solo_Activas) {
  //   return res.status(400).json({ error: 'Faltan parámetros requeridos' });
  // }
  try {
    await sql.connect(sqlConfig);
    // Ejemplo: si parametro2 es el nombre del procedimiento y parametro1 es el valor
    const result = await sql.query(`${procedimiento} ${parametrosListos}`);
    console.log(result);
    res.json({ resultado: JSON.stringify(result) });
  } catch (err) {
    console.error(err);
    fs.appendFile(
      "error.log",
      `[${new Date().toISOString()}] ${err.stack}\n`,
      (fsErr) => {
        if (fsErr) console.error("Failed to write to log:", fsErr);
      }
    );
    res.status(500).json({ error: "Error en el procedimiento" + err.message });
  }
});

app.post("/busqueda/tramites", async (req, res) => {
  try {
    const { instruccionSQL, parametros } = req.body;
    console.log(instruccionSQL);
    console.log(parametros); //


    let stringParametros = "";
    for (let key in parametros) {
      const value = parametros[key];
      if (stringParametros.length > 0) stringParametros += ", ";
      stringParametros += `${key}=${value}`;
    }

    console.log("instruccionSQL", instruccionSQL);
    console.log("stringParametros", stringParametros);
    console.log(`${instruccionSQL}  ${stringParametros}`);

    //Intentar conectarse a la BD
    await sql.connect(sqlConfig);

    // const result = await sql.query(`${instruccionSQL} "${parametro1}" `);
    // const result = await sql.query(`${instruccionSQL} "${parametros}" `);
    // const result = await sql.query(`combo_tasas_ivas @lOtros=0, @lSolo_Activas=0`);
    // const result = await sql.query(`$instruccionSQL  @lOtros=0, @lSolo_Activas=0`);
    const result = await sql.query(`${instruccionSQL}  ${stringParametros}`);

    console.log(result);

    res.status(200).json(result.recordsets);
  } catch (error) {
    console.error("Error al intentar obtener lista dinamica", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Endpoint ejecuta (similar a dinamico/lista)
app.post("/ejecuta", async (req, res) => {
  try {
    const { instruccionSQL, parametros } = req.body;
    console.log(instruccionSQL);
    console.log("a",parametros);

    let stringParametros = "";
    for (let key in parametros) {
      const value = parametros[key];
      if (stringParametros.length > 0) stringParametros += ", ";
      console.log(typeof value)
      console.log(value)
      console.log(key)
      console.log(typeof key)
      if(key.startsWith("@")){
        console.log("it starts with @")
        stringParametros += `${key}=${value}`; 
      }else{
        stringParametros += `${value}`
      }
    }

    console.log("instruccionSQL", instruccionSQL);
    console.log("stringParametros", stringParametros);
    console.log(`${instruccionSQL}  ${stringParametros}`);

    //Intentar conectarse a la BD
    await sql.connect(sqlConfig);

    const result = await sql.query(`${instruccionSQL} ${stringParametros}`);
    console.log(result);
    res.status(200).json(result.recordsets);
  } catch (error) {
    console.error("Error al intentar obtener lista dinamica", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Endpoint para análisis multimodal con IA GEMINI (Se corrige extracción de texto)
app.post('/analizar-documento-gemini', async (req, res) => {
    console.log("[ENDPOINT] /analizar-documento-gemini iniciado."); 

    if (!ai) {
        return res.status(500).json({ success: false, message: "API de Gemini no inicializada. Verifique GEMINI_API_KEY." });
    }
    
    try {
        // 1. EXTRAER LOS NUEVOS ARGUMENTOS
        const { tramite_id, file, tipoDocumento, prompt } = req.body;
        console.log("Datos recibidos:", { tramite_id, tipoDocumento, prompt, file: file ? "Sí" : "No" });

        const model = ai.getGenerativeModel(baseModelConfig);
        //const { tramite_id, file } = req.body;
        const { base64, mimeType } = file; 

        // 2. VALIDACIÓN AMPLIADA DE ENTRADAS
        if (!base64 || !mimeType || !tipoDocumento || !prompt) {
            return res.status(400).json({ success: false, message: "Faltan datos (file,  tipoDocumento, o prompt) en la solicitud." });
        }
        
        console.log(`[Gemini] Análisis para Trámite ID: ${tramite_id}, Tipo: ${mimeType}`);

        // Determinar si el archivo es un documento estructurado (PDF, etc.) o una imagen
        //const isDocumentExtraction = (mimeType.includes('pdf') || mimeType.includes('xml'));
        const isDocumentExtraction = tipoDocumento !== 'Otro'; // Si no es 'otro', asumimos que es documento estructurado

        let dinamicShema;;

        if (tipoDocumento === 'Invoice') {
            dinamicShema = documentExtractionSchema;
        } else {
            dinamicShema = documentExtractionSchema_SP;
        }

        let dynamicPrompt;
        let generationConfig = {};

        if (isDocumentExtraction) {
            // --- CÓDIGO PARA EXTRACCIÓN ESTRUCTURADA (PDF, XML, etc.) ---
            if (!tipoDocumento) {
                return res.status(400).json({ 
                    success: false, 
                    message: "El tipoDocumento es requerido para la extracción de documentos estructurados." 
                });
            }

            dynamicPrompt = `
                ${prompt} 
                
                ---
                
                El documento adjunto es de tipo: "${tipoDocumento}". 
                Tu respuesta DEBE ser ÚNICAMENTE el objeto JSON que se ajusta exactamente al esquema proporcionado. 
                NO incluyas introducciones, explicaciones, o markdown adicional.
            `.trim();
            
            // Configuración para forzar la salida JSON (Asume 'documentExtractionSchema' está disponible)
            generationConfig = { 
                responseMimeType: "application/json",
                responseSchema: dinamicShema, 
            };

        } else {
            // --- CÓDIGO PARA DESCRIPCIÓN DE IMAGEN/FOTO (PNG, JPEG, etc.) ---
            dynamicPrompt = `
                Tu única tarea es describir la imagen adjunta. 
                Utiliza el siguiente contexto proporcionado por el usuario: "${prompt}".
                Responde únicamente con el texto de la descripción.
            `.trim();

            // Quitamos responseMimeType y responseSchema para recibir texto libre
            generationConfig = {}; 
        }
        const contents = [
            { 
                role: "user", 
                parts: [
                    { text: dynamicPrompt },
                    { 
                        inlineData: { data: base64, mimeType: mimeType } 
                    }
                ]
            }
        ];

        // Llamada a la API de Gemini
        const geminiResponse = await model.generateContent({
            contents: contents, 
            generationConfig: generationConfig, // Usamos la configuración dinámica
        });

        // 4. Procesar la Respuesta (LÓGICA ULTRA-ROBUSTA DE EXTRACCIÓN)
        
        let rawText = geminiResponse.text; // Intento 1: Propiedad .text del SDK (Método preferido)

        if (!rawText) {
            // Intento 2: Extracción manual, usando la estructura anidada "response" (del debug log)
            rawText = geminiResponse?.response?.candidates?.[0]?.content?.parts?.[0]?.text;
        }

        if (!rawText) {
            // Intento 3: Extracción manual, usando la estructura estándar del SDK sin el wrapper "response"
            rawText = geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text;
        }

        rawText = rawText?.trim() || null; // Limpieza final

        if (!rawText) {
             console.error("❌ ERROR CRÍTICO: Respuesta de Gemini vacía o sin texto.");
             console.error("RESPUESTA COMPLETA DE GEMINI (DEBUG):", JSON.stringify(geminiResponse, null, 2));

             return res.status(400).json({ 
                 success: false, 
                 message: "La IA no pudo extraer el JSON. Revise la consola del servidor para ver el log.",
                 details: "Respuesta de la IA vacía/bloqueada. VERIFIQUE CONSOLA." 
             });
        }
        
        // Log para ver el texto crudo ANTES de intentar parsear
        console.log("[Gemini RAW] Texto crudo antes de JSON.parse:", rawText.substring(0, 500) + (rawText.length > 500 ? '...' : ''));

        let extractedData;
        if (isDocumentExtraction) {
            // --- PROCESAMIENTO DE JSON (Solo para documentos estructurados) ---
            let extractedData;
            try {
                // 5. Limpieza y Parseo
                rawText = rawText.replace(/^```json\s*|s*```$/g, '').trim(); 
                extractedData = JSON.parse(rawText); 
                
                console.log(`[Gemini] Extracción exitosa para ${tramite_id} (${tipoDocumento}).`);
                console.log("[Gemini Data] Extracted JSON:", JSON.stringify(extractedData, null, 2));

                // Devolver el objeto JSON extraído
                return res.status(200).json({ success: true, data: extractedData });

            } catch (jsonError) {
                console.error("❌ ERROR DE PARSEO JSON:", jsonError.message);
                
                return res.status(500).json({ 
                    success: false, 
                    message: "La IA devolvió un JSON inválido. Consulte la consola (log 'ERROR DE PARSEO JSON').",
                    details: `Gemini devolvió datos malformados. Texto crudo: ${rawText}`
                });
            }
        } else {
            // --- RESPUESTA DE DESCRIPCIÓN DE IMAGEN (Texto libre) ---
            console.log(`[Gemini] Descripción de imagen exitosa para ${tramite_id}.`);
             // Devolver la respuesta de texto libre
            return res.status(200).json({ 
                success: true, 
                data: { description: rawText } 
            });
        }

    } catch (error) {
        console.error("Error al procesar el documento con Gemini:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Error interno al llamar a la IA para el análisis.",
            details: error.message 
        });
    }
});

// Endpoint para análisis de datos con IA GEMINI
app.post("/analisis-ia", async (req, res) => {
    console.log("[ENDPOINT] /analisis-ia iniciado.");
    
    if (!ai) {
        return res.status(500).json({ success: false, message: "API de Gemini no inicializada. Verifique GEMINI_API_KEY." });
    }

    try {
        const { instruccionSQL, parametros, promptAI } = req.body;
        
        if (!instruccionSQL || !promptAI) {
            return res.status(400).json({ error: "Instrucción SQL y promptAI son requeridos." });
        }

        // 1. Ejecutar la consulta SQL para obtener los datos
        const stringParametros = formatSqlParams(parametros);
        const sqlQuery = `${instruccionSQL} ${stringParametros} `;
        console.log(`[SQL QUERY] ${sqlQuery}`); // Log de depuración

        await sql.connect(sqlConfig);
        const result = await sql.query(sqlQuery);
        
        // Asumo que el JSON está en el tercer recordset (recordsets[2][0])
        const jsonString = Object.values(result.recordsets[2][0])[0];
        const datosParaGemini = JSON.parse(jsonString);
        
        // 2. Preparar el prompt
        const fullPrompt = `${promptAI}\n\nAquí están los datos en formato JSON para tu análisis: ${JSON.stringify(datosParaGemini, null, 2)}`;
        
        // 3. Obtener la referencia al modelo 
        const model = ai.getGenerativeModel(baseModelConfig); 

        // 4. Llamar a la API de Gemini 
        const contents = [
            { 
                role: "user", 
                parts: [{ text: fullPrompt }] 
            }
        ];
        const geminiResponse = await model.generateContent({ contents }); 

        // 5. Extraer el texto de la respuesta (LÓGICA ULTRA-ROBUSTA)
        let analisisTexto = geminiResponse.text; // Intento 1: Propiedad .text del SDK (Método preferido)

        if (!analisisTexto) {
            // Intento 2: Extracción manual, usando la estructura anidada "response" que aparece en el debug log
            analisisTexto = geminiResponse?.response?.candidates?.[0]?.content?.parts?.[0]?.text;
        }

        if (!analisisTexto) {
            // Intento 3: Extracción manual, usando la estructura estándar del SDK sin el wrapper "response"
            analisisTexto = geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text;
        }
        
        analisisTexto = analisisTexto?.trim() || null; // Limpieza final

        if (!analisisTexto) {
            // Si sigue siendo nulo, es un error real o un bloqueo.
            analisisTexto = "No se pudo obtener el análisis. Error: El contenido de la IA fue bloqueado o está vacío.";
            console.error("❌ ERROR CRÍTICO: Respuesta de Gemini vacía o bloqueada.");
            console.error("RESPUESTA COMPLETA DE GEMINI (DEBUG):", JSON.stringify(geminiResponse, null, 2));
        }

        console.log("RESPUESTA GEMINI (Extracción exitosa):", analisisTexto.substring(0, 100) + "..."); 

        // 6. Enviar la respuesta analizada al cliente
        res.status(200).json({
            analisis: analisisTexto,
            success: true
        });

    } catch (error) {
        console.error("Error en el endpoint /analisis-ia:", error);
        res.status(500).json({
            error: "Error interno del servidor al procesar la solicitud.",
            details: error.message
        });
    }
});

// Endpoint para análisis con IA CHATGPT (Se mantiene igual)
app.post("/analisis-ia-gpt", async (req, res) => {
    try {
        const { instruccionSQL, parametros, promptAI } = req.body;
        // ... (Lógica de SQL y OpenAI se mantiene)
        if (!instruccionSQL || !promptAI) {
            return res.status(400).json({ error: "Instrucción SQL y promptAI son requeridos." });
        }

        // Ejecución de SQL con la función auxiliar
        const stringParametros = formatSqlParams(parametros);
        const sqlQuery = `${instruccionSQL} ${stringParametros}`;
        console.log(`[SQL QUERY] ${sqlQuery}`); // Log de depuración

        await sql.connect(sqlConfig);
        const result = await sql.query(sqlQuery);
        
        // Aquí debes asegurarte de qué recordset contiene los datos para GPT
        // Asumo recordsets[1][0] como en tu código previo para GPT
        const datosParaGPT = result.recordsets[1][0];

        const fullPrompt = `${promptAI}\n\nAquí están los datos en formato JSON para tu análisis: ${JSON.stringify(datosParaGPT, null, 2)}`;

        const chatCompletion = await openai.chat.completions.create({
            model: "gpt-4o-mini", 
            messages: [{ role: "user", content: fullPrompt }],
        });

        const analisisTexto = chatCompletion.choices[0].message.content;

        res.status(200).json({
            analisis: analisisTexto,
            success: true
        });

    } catch (error) {
        console.error("Error en el endpoint /analisis-ia-gpt:", error);
        res.status(500).json({
            error: "Error interno del servidor al procesar la solicitud.",
            details: error.message
        });
    }
});


// Servidor escuchando en el puerto 3001
app.listen(PORT, () => {
    console.log("listening on port " + PORT);
});
