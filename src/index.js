// require('dotenv').config();
// const OpenAI = require('openai');

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

//Leer variables en archivo .env
const express = require("express");
const sql = require("mssql");
// const jwt = require("jsonwebtoken")
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';
const JWT_EXPIRES_IN = '24h';

const cors = require("cors");

const app = express();

//File System module
const fs = require("fs");

//SQL Server Config
const sqlConfig = require("./config");
// // AI GOOGLE GEMINI
// const { GoogleGenerativeAI } = require("@google/generative-ai");
// // Carga la clave de la API desde una variable de entorno
// const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Asegúrate de tener esta variable en tu archivo .env
// const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Middleware para parsear JSON
app.use(express.json());

//Middleware para cors
app.use(cors());


//Endpoints inician

app.get("/", async (req, res) => {
  try {
    let parametros = {
      parametro1: "      1",
      parametro2: "COMBO_SUCURSALES",
    };
    await sql.connect(sqlConfig);
    const result = await sql.query(
      `${parametros.parametro2} "${parametros.parametro1}"`
    );
    console.log(result);
    res.send("✅ DB connection successful: " + JSON.stringify(result));
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ DB connection failed: " + err.message);
  }
});
//Original login endpoin
// app.post("/user/login", async (req, res) => {
//   try {
//     const { email, password } = req.body;
//     console.log(email, password);

//     // if(email == 'usuarioPrueba' && password == '1234'){
//     //   res.send("Usuario y contraseña correctos")
//     // }else{
//     //   res.status(401).send("Datos incorrectos")
//     // }

//     await sql.connect(sqlConfig);
//     // Ejemplo: si parametro2 es el nombre del procedimiento y parametro1 es el valor
//     const result = await sql.query(`valida_usuario ${email}`);
//     res.json({ resultado: JSON.stringify(result) });
//     // res.send(result)
//     // console.log(result);
//   } catch (err) {
//     console.log("Error al intentar loggearse: ", err);
//   }
// });

//Segundo enpoint funcionando tambien
// app.post('/user/login', async (req, res) => {
//   try {
//     const { email } = req.body;

//     if (!email) {
//       return res.status(400).json({
//         success: false,
//         message: 'Email is required'
//       });
//     }

//     console.log('Login attempt with email:', email);

//     // 🛰️ Connect to DB
//     await sql.connect(sqlConfig);

//     // 🧾 Call your stored procedure
//     const result = await sql.query(`valida_usuario '${email}'`);

//     // ❌ User not found
//     if (!result.recordset || result.recordset.length === 0) {
//       return res.status(401).json({
//         success: false,
//         message: 'User not found'
//       });
//     }

//     const user = result.recordset[0];
//     console.log('User from valida_usuario:', user);

//     // ✅ User exists → generate JWT (no password check for now)
//     const serviceToken = jwt.sign(
//       {
//         id: user.id_usuario,     // adjust field name as needed
//         email: user.correo,      // adjust
//         nombre: user.nombre,     // adjust
//         rol: user.rol            // adjust or remove if not used
//       },
//       JWT_SECRET,
//       { expiresIn: JWT_EXPIRES_IN }
//     );

//     // 📦 Prepare user object (Mantis-compatible format)
//     const userProfile = {
//       id: user.id_usuario,
//       name: user.nombre,
//       email: user.correo,
//       role: user.rol || 'user'
//       // Add more fields if your frontend uses them
//     };

//     // ✅ Send back what Mantis expects
//     return res.json({
//       serviceToken,  // ← must be exactly this key
//       user: userProfile
//     });

//   } catch (err) {
//     console.error('Error during login:', err);
//     return res.status(500).json({
//       success: false,
//       message: 'Internal server error'
//     });
//   }
// });




//Endpoint final
app.post('/user/login', async (req, res) => {
  try {
    const { email: usuarioInput } = req.body; // usuario

    if (!usuarioInput) {
      return res.status(400).json({
        success: false,
        message: 'Usuario is required'
      });
    }

    console.log('Intento de usuario con:', usuarioInput);

    //  Conectar a la BD
    await sql.connect(sqlConfig);

    // LLamada al SP
    const result = await sql.query(`valida_usuario '${usuarioInput}'`);

    // Usuario no encontrado
    if (!result.recordset || result.recordset.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = result.recordset[0];

    // Opcional: revisar si usuario es valido
    if (user.vigencia !== 'Válido') {
      return res.status(401).json({
        success: false,
        message: 'User account is not active'
      });
    }


    // Extraccion de datos para JWT en el front
    const userId = user.usuario; 
    const userEmail = user.usuario; 
    const userName = user.nombre_persona; 
    const userRole = 'user'; 
    const sucursal = user.sucursal;
    const sucursalName = user.nombre_sucursal;
    const id_persona = user.id_persona;

    let menu = [];
    if (result.recordsets[1] && result.recordsets[1][0]) {
      const jsonString = Object.values(result.recordsets[1][0])[0]; // "{ \"Menu\": [...] }"
      const parsed = JSON.parse(jsonString);
      menu = parsed.Menu || [];
    }

    // Generar JWT
    const serviceToken = jwt.sign(
      {
        id: userId,
        email: userEmail,
        name: userName,
        role: userRole,
        sucursal: sucursal,
        sucursalName: sucursalName,
        id_persona: id_persona
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Preparar objeto de usuario
    const userProfile = {
      id: userId,
      name: userName,
      email: userEmail,
      role: userRole,
      sucursal: sucursal,
      sucursalName: sucursalName,
      id_persona: id_persona
    };



    // Devolver usuario + menu
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
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});


//Enpont para verificar si el usuario estaba registrado
// app.post('/user/cuenta/yo', async (req, res) => {
//   try {
//     const authHeader = req.headers.authorization;
//     if (!authHeader || !authHeader.startsWith('Bearer ')) {
//       return res.status(401).json({ message: 'No token provided' });
//     }

//     const token = authHeader.split(' ')[1];
//     const decoded = jwt.verify(token, JWT_SECRET);

//     // Fetch user again using decoded ID/email
//     await sql.connect(sqlConfig);
//     const result = await sql.query(`valida_usuario '${decoded.email}'`);

//     if (result.recordset.length === 0) {
//       return res.status(401).json({ message: 'User not found' });
//     }

//     const user = result.recordset[0];

//     return res.json({
//       user: {
//         id: user.usuario,
//         name: user.nombre_persona,
//         email: user.usuario,
//         role: 'user'
//       }
//     });
//   } catch (err) {
//     console.error('Error in /api/account/me:', err);
//     return res.status(401).json({ message: 'Invalid token' });
//   }
// });



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

    // Menu
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
      menu // ✅ Return menu on refresh
    });
  } catch (err) {
    console.error('Error in /user/cuenta/yo:', err);
    return res.status(401).json({ message: 'Invalid token' });
  }
});

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

app.post("/abcde", async (req, res) => {
  const { nombre, codigo } = req.body;
  if (!nombre || !codigo) {
    return res.status(400).json({ error: "Faltan campos requeridos" });
  }
  try {
    await sql.connect(sqlConfig);
    await sql.query` (${nombre}, ${codigo})`;
    res.json({ message: "" });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ error: "Error al insertar en la base de datos: " + err.message });
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

// Endpoint para análisis con IA GEMINI
app.post("/analisis-ia", async (req, res) => {
  try {
    const { instruccionSQL, parametros, promptAI } = req.body;
    console.log("Instrucción SQL:", instruccionSQL, "Parámetros:", parametros, "Prompt AI:", promptAI);
    // Validación básica de los datos de entrada
    if (!instruccionSQL || !promptAI) {
      return res.status(400).json({ error: "Instrucción SQL y promptAI son requeridos." });
    }

    // Convertir parámetros a un string para la consulta SQL
    let stringParametros = "";
    for (let key in parametros) {
      const value = parametros[key];
      if (stringParametros.length > 0) stringParametros += ", ";
      if (key.startsWith("@")) {
        stringParametros += `${key}=${value}`;
      } else {
        stringParametros += `${value}`;
      }
    }
    // 1. Ejecutar la consulta SQL para obtener los datos
    await sql.connect(sqlConfig);
    //const result = await sql.query(`${instruccionSQL} ${stringParametros} FOR JSON PATH, ROOT('datos_a_analizar')`);
    const result = await sql.query(`${instruccionSQL} ${stringParametros} `);
    
    // 2. Parsear la cadena JSON que devuelve SQL Server
    const jsonString = Object.values(result.recordsets[1][0])[0];
    const datosParaGemini = JSON.parse(jsonString);

    // 3. Preparar el prompt para Gemini con los datos
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
    const fullPrompt = `${promptAI}\n\nAquí están los datos en formato JSON para tu análisis: ${JSON.stringify(datosParaGemini, null, 2)}`;

    // 4. Llamar a la API de Gemini para generar el análisis
    const geminiResult = await model.generateContent(fullPrompt);
    const geminiResponse = await geminiResult.response;
    const analisisTexto = geminiResponse.text();

    // 5. Enviar la respuesta analizada al cliente
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

// Endpoint para análisis con IA CHATGPT
app.post("/analisis-ia-gpt", async (req, res) => {
  try {
    const { instruccionSQL, parametros, promptAI } = req.body;

    if (!instruccionSQL || !promptAI) {
      return res.status(400).json({ error: "Instrucción SQL y promptAI son requeridos." });
    }

    // 1. Ejecutar la consulta SQL (usa la misma lógica de tu endpoint anterior)
    let stringParametros = "";
    for (let key in parametros) {
      const value = parametros[key];
      if (stringParametros.length > 0) stringParametros += ", ";
      if (key.startsWith("@")) {
        stringParametros += `${key}=${value}`;
      } else {
        stringParametros += `${value}`;
      }
    }

    await sql.connect(sqlConfig);
    const result = await sql.query(`${instruccionSQL} ${stringParametros}`);
    //const datosParaGPT = result.recordset;
    const datosParaGPT = result.recordsets[1][0];

    // 2. Preparar el prompt para ChatGPT con los datos
    const fullPrompt = `${promptAI}\n\nAquí están los datos en formato JSON para tu análisis: ${JSON.stringify(datosParaGPT, null, 2)}`;

    // 3. Llamar a la API de ChatGPT para generar el análisis
    // const chatCompletion = await openai.chat.completions.create({
    //   model: "gpt-4o-mini", // Puedes cambiar el modelo (ej: gpt-4, gpt-3.5-turbo)
    //   messages: [{ role: "user", content: fullPrompt }],
    // });

    // 4. Extraer el análisis de la respuesta
    const analisisTexto = chatCompletion.choices[0].message.content;

    // 5. Enviar la respuesta analizada al cliente
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


//Servidor escuchando en el puerto 3001
app.listen(3001, () => {
  console.log("listening on port 3001");
});
