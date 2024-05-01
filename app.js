//Available globals
var domo = window.domo; // For more on domo.js: https://developer.domo.com/docs/dev-studio-guides/domo-js#domo.get
var datasets = window.datasets;

var itemsPerPageOptions = [10, 25, 50, 100];
var paginationSize = 10;
var explanationWriteSpeed = 8; // the lower the faster, 0 is no delay

var selectedDataSet = 'songs';

// Autofills the base template
var sampleQuestions = [
  {
    // Autofills the first question
    question: "Show the first three rows",
    //Autofills the first SQL statement
    sql: `SELECT * FROM ${selectedDataSet} LIMIT 3`,
    //Autofills the first explanation
    explanation: `The SQL statement "SELECT * FROM ${selectedDataSet} LIMIT 3" is used to retrieve data from a table called "${selectedDataSet}" and limit the result to only the first 3 rows.\n\nExplanation:\n- "SELECT *" means that we want to select all columns from the table.\n- "FROM ${selectedDataSet}" specifies the table we want to retrieve data from, which is "${selectedDataSet}".\n- "LIMIT 3" limits the result to only the first 3 rows.\n\nErrors in the SQL query:\nThere are no apparent errors in the SQL query provided. However, it's worth noting that the query assumes the table "${selectedDataSet}" exists in the database. If the table name is incorrect or doesn't exist, an error will occur.`,
  }
];

var questionForm = document.getElementById("questionForm");
var questionInput = document.getElementById("questionInput");
var dataTable = document.getElementById("dataTable");
var submitSqlButton = document.getElementById('submitButton');
var explanationBlock = document.getElementById("explanationBlock");
var explainSqlButton = document.getElementById("explainSqlButton");
var explanationEl = document.getElementById("sqlExplanation");

// Setup SQL Editor
var editor = ace.edit("sqlStatement", {
  mode: "ace/mode/sql",
  selectionStyle: false,
  theme: "ace/theme/github",
  showPrintMargin: false,
});

// When the SQL Qquery is changed the explanation is cleared
editor.on('change', clearExplanation);
// Handles the ask button and question submission
questionForm.addEventListener('submit', handleQuestionSubmit);
// Handles the expain button
explainSqlButton.addEventListener('click', handleExplainButtonClick); 
// Handles the run SQL button
submitSqlButton.addEventListener('click', handleSqlButtonClick);

// Get the data
var table, dataSourceSchema;
Promise.all([
    getDataSetSchema(selectedDataSet),
    loadQuestion(selectedDataSet, 0),
  ])
  .then(handleResult);

// ? 
function handleResult(result){
  dataSourceSchema = result[0];
  var data = result[1];
  
  updateTable(data);
}
// ?
function loadQuestion(dataset, questionIndex){
  var sampleQuestion = sampleQuestions[questionIndex];
  questionInput.value = sampleQuestion.question; // This sets first question
  editor.setValue(sampleQuestion.sql); // This sets first sql statement
  editor.clearSelection(); //?
  if(sampleQuestion.explanation){
    setExplanation(sampleQuestion.explanation); // If the sample question was used give the sample explanation
  }

  return domo.post(`/sql/v1/${dataset}`, sampleQuestion.sql, {contentType:'text/plain'}); //?
}

// Get the dataset Schema from the wired dataset -> pass in the dataset alias from the manifest file
async function getDataSetSchema(dataSetAlias) {
  // Qurey one row of the data
  var getRowQuery = `SELECT * from ${makeSafeText(dataSetAlias)} limit 1`; // the sql endpoint includes schema information we can use
  try{
    // Queries one row from the domo dataset
    var singleRow = await domo.post(`/sql/v1/${makeSafeText(dataSetAlias)}`, getRowQuery, {contentType:'text/plain'})

    // Uses one row to map the schema to a column and type based on the data
    var dataSetSchemaColumns = singleRow.columns.map((column, index) => ({
      name: column,
      type: singleRow.metadata[index].type
    }));
    // returns the dataset alias, description, and columns
    return {
      dataSourceName: dataSetAlias,
      description: "",
      columns: dataSetSchemaColumns
    };
  }
  catch(err){
    // Error Handling for schema
    err.message = "Error: Unable to load DataSet Schema."
    handleError(err);
    return {};
  }
}

// Called when play button (Query submit button) is pressed, and sends post request to domo to get data
function submitSQLQueryToDomo(sqlQuery, dataSetAlias) {
  return domo.post(`/sql/v1/${makeSafeText(dataSetAlias)}`, makeSafeText(sqlQuery), {contentType:'text/plain'});
}
// Generates the data table with the passed in data
function getTableData(data){
  return data.rows.map(row => {
    var obj = {};
    data.columns.forEach((column, index) => {
        obj[makeSafeText(column)] = makeSafeText(row[index]);
    });
    return obj;
  });
}

// Updates the table based on neq data from query
function updateTable(data){
  // If null, destroy the table
  if(table != null){
    table.destroy();
  }
  // Created the data table with the new data
  var options = {
    data: getTableData(data),
    layout:"fitDataFill",
    autoColumns:true,
  }
  // Sets the pagination based on the global variable so the table goes to a second, thrid page based on returned query
  var showPagination = data && data.rows && data.rows.length > paginationSize;
  if(showPagination){
    Object.assign(options, {
      pagination:"local",
      paginationSize: paginationSize,
      paginationSizeSelector: itemsPerPageOptions,
      paginationCounter:"rows",
    });
  }
  table = new Tabulator(dataTable, options); // ?
}
// Adds the Spinner for loading
function toggleButtonSpinner(el, flag){
  if(flag === false || Array.from(el.classList).indexOf('loading') >= 0){
    el.classList.remove('loading');
    if(el.dataset.prev){
      el.innerHTML = el.dataset.prev;
    }
  }
  else{
    el.classList.add('loading');
    el.dataset.prev = el.innerHTML;
    el.innerHTML = 
      `<div class="spinner-border" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>`;
  }
}

// Handles the question submission process
async function handleQuestionSubmit(event) {
  // Prevent the form from being submitted normally
  event.preventDefault();

  // Get the value of the question input field
  var question = questionInput.value;

  // Disable the submit button during loading, and have the button say Generating SQL
  var submitButton = document.getElementById('generateSQLButton');
  submitButton.disabled = true;
  var prevLabel = submitButton.innerText;
  submitButton.innerText = 'Generating SQL...';

  try{
    // Successful and turn ask button back on
    await handleFormSubmission(question, editor);
    submitButton.disabled = false;
    submitButton.innerText = prevLabel;
  }
  catch(err) {
    // Error Handling
    submitButton.disabled = false;
    submitButton.innerText = prevLabel;
    err.message = "SQL generation failed. Please try again or adjust your question.";
    handleError(err);
  }
}

// Clears the text to be empty
function clearExplanation(){
  explanationEl.innerText = "";
  explanationBlock.classList.add('empty');
}
// Sets the explanation with the AI generated response or text
function setExplanation(text){
  explanationBlock.classList.remove('empty');
  explanationEl.innerText = "";
  typeText(explanationEl, text);
}

// Handles the SQL explanation process
async function handleExplainButtonClick(event) {
  explainSqlButton.disabled = true; // Disables the explain button while it is loading the solution
  setExplanation('Getting Explanation...'); // Loading prompt
  toggleButtonSpinner(explainSqlButton, true); // Spinner is activated
  var sqlStatement = editor.getValue(); // Retrieves that response

  try{
    // Successful response
    var sqlExplanation = await explainSql(sqlStatement);
    explainSqlButton.disabled = false; // Button is pushable
    toggleButtonSpinner(explainSqlButton, true); // Spinner is off
    setExplanation(sqlExplanation); // Set explanation
  }
  catch(err) {
    // Error Handling
    explainSqlButton.disabled = false;
    toggleButtonSpinner(explainSqlButton, true);
    err.message = "SQL Explanation failed. Please try again or adjust your query.";
    handleError(err);
  }
}


// Handles the run SQL prompt button
async function handleSqlButtonClick(event) {
  submitSqlButton.disabled = true; // Diables the the SQL submit button
  var sqlStatement = editor.getValue(); // Retrieves the value from the AI generator 
  dataTable.classList.add('loading'); // Message turns on
  toggleButtonSpinner(submitSqlButton, true); // Spinner on

  try{
    // Successful SQL query
    var refreshedData = await submitSQLQueryToDomo(sqlStatement, selectedDataSet); // Retrieves the data from the SQL query in Domo
    submitSqlButton.disabled = false; // Run option enabled
    dataTable.classList.remove('loading'); // Message goes away
    updateTable(refreshedData); // Updates Table with new data
    toggleButtonSpinner(submitSqlButton, false); // Spinner goes off
  }
  catch(err) {
    // Error Handling
    submitSqlButton.disabled = false;
    dataTable.classList.remove('loading');
    toggleButtonSpinner(submitSqlButton, false);
    err.message = "SQL Query failed. Check that your query doesn't have any typos or try the 'Explain SQL' button to try and diagnose the issue.";
    handleError(err);
  }
}

// Takes input question and sends 
async function handleFormSubmission(question, sqlEditor) {
  // Calls the text to SQL function with hte question and schema
  var sqlPrompt = await textToSql(question, dataSourceSchema);
  // Assignes the output to the SQL statement
  var sqlStatement = sqlPrompt.choices[0].output;

  // Display the SQL statement in the code editor
  sqlEditor.setValue(sqlStatement);

  return sqlStatement;
}

// Performs the text to SQL post request
function textToSql(text, dataSourceSchema) {
  // Payload takes the input and schema
  var payload = {
    input: text,
    dataSourceSchemas: [dataSourceSchema]
  };
  // returns the ai response
  return domo.post("domo/ai/v1/text/sql", payload);
}

// Explains the SQL query and returns the reponse
async function explainSql(sql){
  // Prompt to AI
  var prompt = `Please (ELI5) the following sql statement to me: ${sql}. Please be as concise as possible and explain any errors that you find in the SQL query.`;
  // Endpoint details
  var endpoint = {
    url: "generation",
    body: {
      "input": prompt
    }
  };
  // Retrieves the AI reponse from the text generation of the query
  var sqlExplanation = await domo.post('/domo/ai/v1/text/' + endpoint.url, endpoint.body);
  // returns the explanation
  return sqlExplanation.choices[0] && sqlExplanation.choices[0].output;
}

// typing animation function that can be used to simulate typing text
function typeText(element, text, index = 0) {
  // element This is the HTML element where the text will be typed.
  // text This is the text that you want to type into the element.
  // index his is the index indicating the current position in the text to start typing from.
  var typeTextRecursive = function(element, text, index = 0){
    if (index < text.length) {
      element.innerHTML = element.textContent + text.charAt(index);
      setTimeout(() => typeText(element, text, index + 1), explanationWriteSpeed);
    }
  }
  if(explanationWriteSpeed > 0){
    typeTextRecursive(element, makeSafeText(text), index);
  }
  else{
    element.innerHTML = makeSafeText(text);
  }
}

// Error Handling Functions
function handleError(error) {
  var message = error && error.message;
  if(message && typeof message === 'string'){
    if(message.toLowerCase() === 'forbidden'){
      message = "Please contact ai@domo.com to request this feature be enabled in your instance."
    }
    else if(message.toLowerCase() === 'bad request'){
      message = "Bad request. Please check the code submitting the request to ensure it looks correct and try again."
    }
  }
  else{ // If there is no message, assume the ai endpoint is disabled
    message = "Please contact ai@domo.com to request this feature be enabled in your instance."
  }
  appendAlert(message);
  console && console.warn && console.warn('Error: ' + message);
}

// Alert Message when error occurs
function appendAlert(message, hideIcon = true){
  var svg = hideIcon 
    ? '' 
    : '<svg class="bi flex-shrink-0 me-2" width="24" height="24" role="img" aria-label="Danger:"><use xlink:href="#exclamation-triangle"/></svg>';
  var alert = `
    <div class="alert alert-warning alert-dismissible fade show" role="alert">
      ${svg}
      <span>
        ${makeSafeText(message)}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      </span>
    </div>`;

  var alertMessage = document.getElementById("alert-message");
  alertMessage.innerHTML = alert;
}

// Create a safe version of an input value to be stored to the database
// Transforms: "<h1>test</h1>"  =>  "&lt;h1&gt;test&lt;/h1&gt;"
function makeSafeText(text){
  return String(text)
    .replace(/&[/s]+/g, '&amp; ')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Decode the text before displaying as an input value
// Example: "&lt;h1&gt;test&lt;/h1&gt;"  =>  "<h1>test</h1>"
function decodeSafeText(text){
  var div = document.createElement('div');
  div.innerHTML = makeSafeText(text);
  return div.innerText;
}