var esprima = require("esprima");
var options = {tokens:true, tolerant: true, loc: true, range: true };
var faker = require("faker");
var fs = require("fs");
faker.locale = "en";
var mock = require('mock-fs');
var _ = require('underscore');
var Random = require('random-js');

function main()
{
	var args = process.argv.slice(2);

	if( args.length == 0 )
	{
		args = ["subject.js"];
	}
	var filePath = args[0];

	constraints(filePath);

	generateTestCases()

}

var engine = Random.engines.mt19937().autoSeed();

function createConcreteIntegerValue( greaterThan, constraintValue )
{
	if( greaterThan )
		return Random.integer(constraintValue,constraintValue+10)(engine);
	else
		return Random.integer(constraintValue-10,constraintValue)(engine);
}

function Constraint(properties)
{
	this.ident = properties.ident;
	this.expression = properties.expression;
	this.operator = properties.operator;
	this.value = properties.value;
	this.funcName = properties.funcName;
	// Supported kinds: "fileWithContent","fileExists"
	// integer, string, phoneNumber
	this.kind = properties.kind;
}

function fakeDemo()
{
	console.log( faker.phone.phoneNumber() );
	console.log( faker.phone.phoneNumberFormat() );
	console.log( faker.phone.phoneFormats() );
}

var functionConstraints =
{
}

var mockFileLibrary = 
{
	pathExists:
	{
		'some/path/dirExists': {
			"fileExists1": "",
			"fileExists2": "content"
		},
		'path/emptyDir': {}
	},
	fileWithContent:
	{
		"some/path/fileExists": {
			"emptyFile": "",
			"nonEmptyFile": "content"
		}
	}
};

function generateTestCases()
{

	var content = "var subject = require('./subject.js')\nvar mock = require('mock-fs');\n";
	for ( var funcName in functionConstraints )
	{
		var params = {};

		// initialize params
		for (var i =0; i < functionConstraints[funcName].params.length; i++ )
		{
			var paramName = functionConstraints[funcName].params[i];
			//params[paramName] = '\'' + faker.phone.phoneNumber()+'\'';
			params[paramName] = ['\'\''];
		}

		//console.log( params );

		// update parameter values based on known constraints.
		var constraints = functionConstraints[funcName].constraints;
		// Handle global constraints...
		var fileWithContent = _.some(constraints, {kind: 'fileWithContent' });
		var pathExists      = _.some(constraints, {kind: 'fileExists' });

		// plug-in values for parameters
		for( var c = 0; c < constraints.length; c++ )
		{
			var constraint = constraints[c];
			if( params.hasOwnProperty( constraint.ident ) )
			{
				if(params[constraint.ident][0] == '\'\''){
					params[constraint.ident] = [constraint.value];
				}
				else{
					params[constraint.ident].push(constraint.value);
				}
			}
		}

		// Prepare function arguments.
		//var args = Object.keys(params).map( function(k) {return params[k]; }).join(",");
		var keys = Object.keys(params);
		var args = [];
		for(var i=0; i<keys.length; i++){
			if(i==0){
				args = JSON.parse(JSON.stringify(params[keys[i]]));
			}
			else{
				var newArgs = [];
				for(var j=0; j<params[keys[i]].length; j++){
					for(var k=0; k<args.length; k++){
						newArgs.push(args[k] + "," + params[keys[i]][j]);
					}
				}
				args = newArgs;
			}
		}
		for(var i=0; i<args.length; i++) {
			if( pathExists || fileWithContent )
			{
				content += generateMockFsTestCases(pathExists,fileWithContent,funcName, args[i]);
				// Bonus...generate constraint variations test cases....
				//content += generateMockFsTestCases(!pathExists,fileWithContent,funcName, args);
				//content += generateMockFsTestCases(pathExists,!fileWithContent,funcName, args);
				//content += generateMockFsTestCases(!pathExists,!fileWithContent,funcName, args);
			}
			else
			{
				// Emit simple test case.
				content += "subject.{0}({1});\n".format(funcName, args[i]);
			}
		}


	}


	fs.writeFileSync('test.js', content, "utf8");

}

function generateMockFsTestCases (pathExists,fileWithContent,funcName,args) 
{
	var testCase = "";
	// Build mock file system based on constraints.
	var mergedFS = {};
	if( pathExists )
	{
		for (var attrname in mockFileLibrary.pathExists) { mergedFS[attrname] = mockFileLibrary.pathExists[attrname]; }
	}
	if( fileWithContent )
	{
		for (var attrname in mockFileLibrary.fileWithContent) { mergedFS[attrname] = mockFileLibrary.fileWithContent[attrname]; }
	}

	testCase += 
	"mock(" +
		JSON.stringify(mergedFS)
		+
	");\n";

	testCase += "\tsubject.{0}({1});\n".format(funcName, args );
	testCase+="mock.restore();\n";
	return testCase;
}

function constraints(filePath)
{
   var buf = fs.readFileSync(filePath, "utf8");
	var result = esprima.parse(buf, options);

	traverse(result, function (node) 
	{
		if (node.type === 'FunctionDeclaration') 
		{
			var funcName = functionName(node);
			console.log("Line : {0} Function: {1}".format(node.loc.start.line, funcName ));

			var params = node.params.map(function(p) {return p.name});

			functionConstraints[funcName] = {constraints:[], params: params};

			// Check for expressions using argument.
			traverse(node, function(child)
			{
				if( child.type === 'BinaryExpression' && (child.operator == "==" || child.operator == "!="))
				{
					if( child.left.type == 'Identifier' && params.indexOf( child.left.name ) > -1)
					{
						// get expression from original source code:
						var expression = buf.substring(child.range[0], child.range[1]);
						var rightHand = buf.substring(child.right.range[0], child.right.range[1])

						functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: child.left.name,
								value: rightHand,
								funcName: funcName,
								kind: "integer",
								operator : child.operator,
								expression: expression
							}));
						functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: child.left.name,
								value: "\"RANDOMSTRING\"",
								funcName: funcName,
								kind: "integer",
								operator : child.operator,
								expression: expression
							}));
					}
					
					else if (child.left.type == 'Identifier' && params.indexOf( child.left.name ) < 0)  
					{	

						var expression = buf.substring(child.range[0], child.range[1]);
						var rightHand = buf.substring(child.right.range[0], child.right.range[1]);
						
						var a = rightHand.split('"');
						var areaCode;
						if (a.length == 1)
							areaCode = a[0];
						else if (a.length == 3)
							areaCode = a[1];
						else if ((a.length == 2) && a[0] == '')
							areaCode = a[1];
						else if ((a.length == 2) && a[1] == '')
							areaCode = a[0];

						var phoneNumber = faker.phone.phoneNumberFormat();
						var unformattedPhone = phoneNumber;
						phoneNumber = phoneNumber.replace(/^\d{3}/,areaCode);

						functionConstraints[funcName].constraints.push(
							new Constraint(
							{
								ident: params[0],
								value: "'{0}'".format(phoneNumber),
								funcName: funcName,
								kind: "integer",
								operator: child.operator,
								expression: expression

							}),
							new Constraint(
							{
								ident: params[0],
								value: "'{0}'".format(unformattedPhone),
								funcName: funcName,
								kind: "integer",
								operator: child.operator,
								expression: expression
							})
						);

					} 
				
					else if (child.left.type === 'CallExpression' && params.indexOf(
						child.left.callee.object.name) > -1) 
					{
						var expression = buf.substring(child.range[0], child.range[1]);
						var rightHand = buf.substring(child.right.range[0], child.right.range[1]);
						
						functionConstraints[funcName].constraints.push(
							new Constraint(
							{
								ident: child.left.callee.object.name,
								value: child.left.arguments[0].raw,
								funcName: funcName,
								kind: "integer",
								operator: child.operator,
								expression: expression
							}),
							new Constraint(
							{
								ident: child.left.callee.object.name,
								value: "\"RANDOMEXPPRESSION\"",
								funcName: funcName,
								kind: "integer",
								operator: child.operator,
								expression: expression
							})
						);
					}

				}

				if( child.type === 'BinaryExpression' && (child.operator == "<" || child.operator == ">" ))
				{
					if( child.left.type == 'Identifier' && params.indexOf( child.left.name ) > -1)
					{
						// get expression from original source code:
						var expression = buf.substring(child.range[0], child.range[1]);
						var rightHand = buf.substring(child.right.range[0], child.right.range[1])

						functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: child.left.name,
								value: rightHand,
								funcName: funcName,
								kind: "integer",
								operator : child.operator,
								expression: expression
							}));

						functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: child.left.name,
								value: parseInt(rightHand)+1,
								funcName: funcName,
								kind: "integer",
								operator : child.operator,
								expression: expression
							}));

						functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: child.left.name,
								value: parseInt(rightHand)-1,
								funcName: funcName,
								kind: "integer",
								operator : child.operator,
								expression: expression
							}));
					}
					else if (child.left.type == 'Identifier' && funcName == 'blackListNumber') {
						var expression = buf.substring(child.range[0], child.range[1]);
						var rightHand = buf.substring(child.right.range[0], child.right.range[1]);
						var areaCode = child.right.value;

						console.log("BlackList: ", areaCode);
						var phoneNumber = faker.phone.phoneNumberFormat();
						var unformattedPhone = phoneNumber;
						phoneNumber = phoneNumber.replace(/^\d{3}/,areaCode);
						console.log("BlackList: ", phoneNumber);
						
						functionConstraints[funcName].constraints.push(
							new Constraint(
							{
								ident: params[0],
								value: "'{0}'".format(phoneNumber),
								funcName: funcName,
								kind: "integer",
								operator: child.operator,
								expression: expression

							}),
							new Constraint(
							{
								ident: params[0],
								value: "'{0}'".format(unformattedPhone),
								funcName: funcName,
								kind: "integer",
								operator: child.operator,
								expression: expression
							})
						);
					}
				}

				if (child.type === 'UnaryExpression' && child.operator == "!") {
					if (child.argument.type === 'Identifier' 
						&& params.indexOf(child.argument.name) > -1) {
						var expression = buf.substring(child.range[0], child.range[1]);
						functionConstraints[funcName].constraints.push(
							new Constraint(
							{
								ident: child.argument.name,
								value: true,
								funcName: funcName,
								kind: "integer",
								operator: child.operator,
								expression: expression
							}),
							new Constraint(
							{
								ident: child.argument.name,
								value: false,
								funcName: funcName,
								kind: "integer",
								operator: child.operator,
								expression: expression
							})
							
						);
					}
					if (child.argument.type === 'MemberExpression' && 
						params.indexOf(child.argument.object.name) > -1) {
						
						var placeholder = child.argument.property.name;
						var optionsTrue = "\{\"{0}\": true\}".format(placeholder);
						var optionsFalse = "\{\"{0}\": false\}".format(placeholder);

						var expression = buf.substring(child.range[0], child.range[1]);

						functionConstraints[funcName].constraints.push(
							new Constraint(
							{
								ident: child.argument.object.name,
								value: optionsTrue,
								funcName: funcName,
								kind: "integer",
								operator: child.operator,
								expression: expression
							}),
							new Constraint(
							{
								ident: child.argument.object.name,
								value: optionsFalse,
								kind: "integer",
								operator: child.operator,
								expression: expression
							})
						)

					}
				}

				if (child.type === 'ForStatement') {
					if (child.init.declarations.length > 0) {
						for (var index in child.init.declarations) {
							dec = child.init.declarations[index];
							if (dec.init.hasOwnProperty("object")) {
								if (params.indexOf(dec.init.object.name) > -1) {
									var phoneNumber = faker.phone.phoneNumberFormat();
									functionConstraints[funcName].constraints.push(
										new Constraint(
										{
											ident: dec.init.object.name,
											value: "\"{0}\"".format(phoneNumber),
											funcName: funcName,
											kind: "integer",
											operator: "=",
											expression: undefined
										})
									);
								}
							}
						}
					}

					if (child.body.body.length > 0) {
						for (var index in child.body.body) {
							var body = child.body.body[index];
							var right = body.expression.right;
							if (right.type == "CallExpression") {
								if (right.callee.hasOwnProperty("object")) {
									if (params.indexOf(right.callee.object.name) > -1) {
										var expression = buf.substring(child.range[0], 
											child.range[1])
										var format = faker.phone.phoneFormats();
										functionConstraints[funcName].constraints.push(
											new Constraint(
											{
												ident: right.callee.object.name,
												value: "'{0}'".format(format),
												funcName: funcName,
												kind: "integer",
												operator: "'{0}'".format(body.expression.operator),
												expression: expression
											})
										)
									}
								}
							}
						}
					}
				}


				if( child.type === 'BinaryExpression' && (child.operator == ">" && child.operator == "<" ))
				{
					if( child.left.type == 'Identifier' && params.indexOf( child.left.name ) > -1)
					{
						// get expression from original source code:
						var expression = buf.substring(child.range[0], child.range[1]);
						var rightHand = buf.substring(child.right.range[0], child.right.range[1])

						functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: child.left.name,
								value: rightHand,
								funcName: funcName,
								kind: "integer",
								operator : child.operator,
								expression: expression
							}));
					}
				}

				if( child.type == "CallExpression" && 
					 child.callee.property &&
					 child.callee.property.name =="existsSync" )
				{
					for( var p =0; p < params.length; p++ )
					{
						if( child.arguments[0].name == params[p] )
						{	
							if (p == 0) {
								var dir = "some/path/dirExists";
								var emptyDir = "path/emptyDir";
								var fakeDir = "some/path/dirExists/fakeDir";
								functionConstraints[funcName].constraints.push( 
								new Constraint(
								{
									ident: params[p],
									value:  "'{0}'".format(dir),
									funcName: funcName,
									kind: "fileExists",
									operator : child.operator,
									expression: expression
								}),
								new Constraint(
								{
									ident: params[p],
									value: "'{0}'".format(emptyDir),
									funcName: funcName,
									kind: "fileExists",
									operator: child.operator,
									expression: expression
								}),
								new Constraint(
								{
									ident: params[p],
									value: "'{0}'".format(fakeDir),
									funcName: funcName,
									kind: "fileExists",
									operator: child.operator,
									expression: expression
								}));
							}
							else
							{
								var file = "some/path/fileExists/nonEmptyFile";
									var emptyFile = "some/path/fileExists/emptyFile";
									var fakeFile = "some.path/fileExists/fakeFile";
									functionConstraints[funcName].constraints.push( 
										new Constraint(
										{
											ident: params[p],
											value:  "'{0}'".format(file),
											funcName: funcName,
											kind: "fileWithContent",
											operator : child.operator,
											expression: expression
										}),
										new Constraint(
										{
											ident: params[p],
											value: "'{0}'".format(emptyFile),
											funcName: funcName,
											kind: "fileWithContent",
											operator: child.operator,
											expression: expression
										}),
										new Constraint(
										{
											ident: params[p],
											value: "'{0}'".format(fakeFile),
											funcName: funcName,
											kind: "fileWithContent",
											operator: child.operator,
											expression: expression
										})
									);
							}
						}
					}
				}

				if( child.type == "CallExpression" &&
					 child.callee.property &&
					 child.callee.property.name =="readdirSync")
				{
					for( var p =0; p < params.length; p++ )
					{
						if( child.arguments[0].name == params[p] )
						{
							var dir = "some/path/dirExists";
								var emptyDir = "path/emptyDir";
								var fakeDir = "some/path/dirExists/fakeDir";
								functionConstraints[funcName].constraints.push( 
								new Constraint(
								{
									ident: params[p],
									value:  "'{0}'".format(dir),
									funcName: funcName,
									kind: "fileExists",
									operator : child.operator,
									expression: expression
								}),
								new Constraint(
								{
									ident: params[p],
									value: "'{0}'".format(emptyDir),
									funcName: funcName,
									kind: "fileExists",
									operator: child.operator,
									expression: expression
								}),
								new Constraint(
								{
									ident: params[p],
									value: "'{0}'".format(fakeDir),
									funcName: funcName,
									kind: "fileExists",
									operator: child.operator,
									expression: expression
							}));
						}
					}
				}

			});

			console.log( functionConstraints[funcName]);

		}
	});
}

function traverse(object, visitor) 
{
    var key, child;

    visitor.call(null, object);
    for (key in object) {
        if (object.hasOwnProperty(key)) {
            child = object[key];
            if (typeof child === 'object' && child !== null) {
                traverse(child, visitor);
            }
        }
    }
}

function traverseWithCancel(object, visitor)
{
    var key, child;

    if( visitor.call(null, object) )
    {
	    for (key in object) {
	        if (object.hasOwnProperty(key)) {
	            child = object[key];
	            if (typeof child === 'object' && child !== null) {
	                traverseWithCancel(child, visitor);
	            }
	        }
	    }
 	 }
}

function functionName( node )
{
	if( node.id )
	{
		return node.id.name;
	}
	return "";
}


if (!String.prototype.format) {
  String.prototype.format = function() {
    var args = arguments;
    return this.replace(/{(\d+)}/g, function(match, number) { 
      return typeof args[number] != 'undefined'
        ? args[number]
        : match
      ;
    });
  };
}

main();
