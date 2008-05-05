var gShowBtn;
var gHideBtn;
var gClearAuthBtn;
/*  USE ME IF YOU WANT
var gRTMShared = ""; 
*/
var gRTMAPIKey = "87b748d22dca6a95a2674048ea627c76";
var gRTMAuthUrl = "http://www.rememberthemilk.com/services/auth/";
var gRTMMethUrl = "http://api.rememberthemilk.com/services/rest/";
var gRTMAuthToken;
var gRTMUserId;
var gRTMTimelineId = -1;
	
var itemNum = 0;

var showPrefs = function () { 
	$("#front").hide();
	$("#back").show();
};
var hidePrefs = function () {
	$("#back").hide();
	$("#front").show();
};

var markTaskDone = function (e) {
	var attrs = e.target.id.split("_");
	var args = {
		list_id: attrs[0],
		taskseries_id: attrs[1],
		task_id: attrs[2],
		timeline: rtmTimeline()
	};

	rtmCall("rtm.tasks.complete", args);

	log("marking done " + $(e.target).attr("name").split("_")[1]);
};

/*
singleton for generating a timeline id
*/
var rtmTimeline = function () {
	if(gRTMTimelineId < 0) {
		var res = eval(rtmCall("rtm.timelines.create", null));

		gRTMTimelineId = Number(res.timeline);
	}

	return String(gRTMTimelineId);
};

/*
method to fill out the task list
*/
var populateTasks = function () {
	var tasks = rtmCall("rtm.tasks.getList", null);
	log("tasks: " + tasks);

	tasks = eval(tasks);

	for(var list in tasks) {
		for(var taskseries in list) {
			for (var el in taskseries) {
				if(task == "task") {
					addTaskToList(taskseries.name, list.id, taskseries.id, task.id, task.due);
				}
			}
		}
	}

//	$("#listid").html(tasks.list.id);
};

/*
creates a list item for a task, called mainly from populateTasks()
*/
var addTaskToList = function(name, list_id, taskseries_id, task_id, due) {
	var newItem = $("#itemTemplate").clone();

	newItem.children(".title:first").html(String(name));
	newItem.children(".due:first").html(String(due));
	newItem.children(".task_chk:first").attr(name, "chk_" + String(list_id) + "_" + String(taskseries_id) + "_" + String(task_id));
	newItem.children(".task_chk:first").change(markTaskDone);
	
	newItem.show();
	
	$("#taskList").append(newItem);
	log("appended item " + String(name) + ", due " + String(due) + " with id " + String(id));
};

/*
silly testing function on the back of the widget
*/
var getMethodInfo = function (e) {
	var args = {method: "rtm.reflection.getMethodInfo", method_name: $("#methodName").attr("value"), api_key: gRTMAPIKey};
	rtmSign(args);

	$("#methodDisp").html(rtmAjax(gRTMMethUrl, args));
};


/*******
the main machinery
********/
/*
a singleton message for the frob item
*/
var rtmGetFrob = function () {
	if(window.widget && 
			widget.preferenceForKey("frob") != "undefined" && 
			typeof(widget.preferenceForKey("frob")) != "undefined") {
		log ("returning frob: " + String(widget.preferenceForKey("frob")));
		return widget.preferenceForKey("frob");
	}

	var frobArgs = {method: "rtm.auth.getFrob", api_key: gRTMAPIKey, format: "json"};
	rtmSign(frobArgs);
	
	var frobRet = eval(rtmAjax(gRTMMethUrl, frobArgs));
	log("frob: " + frobRet.rsp.frob);

	if(frobRet.rsp.stat == "ok") {
		if(window.widget) widget.setPreferenceForKey(frobRet.rsp.frob, "frob");
			
		return frobRet.rsp.frob;
	} else {
		return "failure";
	}
};

/*
the interface to RTM; checks authentication, makes sure args are signed, etc

this method automatically fills in:

 - api_key
 - method
 - format == json

*/
var rtmCall = function (methName, args) { 
	var ajaxArgs = (args == null) ? {} : args;

	/*
	first check token status
	*/
	if(!checkAuthTokenValid()) {
		/*
		we don't have a valid token, move along, move along
		*/
		$("#needToAuth").show();
		$("#needToAuth a:first").click(openAuthUrl);
		if(widget) widget.setPreferenceForKey(null, "authtoken");
		gRTMAuthToken = "";

		return "need token";
	}

	gRTMAuthToken = tokenRet.rsp.auth.token;
	gRTMUserId = tokenRet.rsp.auth.user.id;

	if(widget) {
		widget.setPreferenceForKey(gRTMAuthToken, "authtoken");
		widget.setPreferenceForKey(gRTMUserId, "userid");
		widget.setPreferenceForKey(gRTMUserId, "username");
		widget.setPreferenceForKey(gRTMUserId, "fullname");
	}


	ajaxArgs.method = methName;
	ajaxArgs.format = "json";
	ajaxArgs.api_key = gRTMAPIKey;
	if(gRTMAuthToken != "" && gRTMAuthToken != "undefined") ajaxArgs.auth_token = gRTMAuthToken;
	if(typeof(ajaxArgs.api_sig) == "undefined") rtmSign(ajaxArgs);

	return rtmAjax(gRTMMethUrl, ajaxArgs);
};

var checkAuthTokenValid = function () {
	var tokenRet;
	var authArgs;

	if(typeof(gRTMAuthToken) != "undefined" &&
			gRTMAuthToken != "" && 
			gRTMAuthToken != "undefined") {
		authArgs = {method: "rtm.auth.checkToken", api_key: gRTMAPIKey, auth_token: gRTMAuthToken, format: "json"}
	} else {
		authArgs = {method: "rtm.auth.getToken", api_key: gRTMAPIKey, format: "json", frob: rtmGetFrob()};
	}

	rtmSign(authArgs);
	tokenRet = eval(rtmAjax(gRTMMethUrl, authArgs));
	log("tokenRet.rsp.stat: " + tokenRet.rsp.stat);

	return (tokenRet.rsp.stat == "ok");
};

/*
the interface that actually takes care of doing the AJAX call
*/
var rtmAjax = function (url, data) {
	if(typeof(data) != "object") return "Need a data object";
	if(typeof(data.api_key) == "undefined") return "Need an api_key";
	if(typeof(data.method) == "undefined") return "Need a method name";
	if(typeof(data.api_sig) == "undefined") return "Need an api_sig";

	var retVal = $.ajax({
		url: url,
		data: data,
		error: function (req, stat, exc) {
			log("<span class='error'>ERROR: " + String(req) + "<br/>" + stat + "</span>");
		}
	});

	return retVal.responseText;
};

/*
utility function to clean house on authorization tokens
*/
var clearAuthTokens = function (e) {
	if(widget) {
		widget.setPreferenceForKey(null, "frob");
		widget.setPreferenceForKey(null, "authtoken");
	}

	log('auth tokens cleared');
};

/*
method arguments signing function
*/
var rtmSign = function (args) {
	var elArr = [];
	var normStr = "";
	var url = "http://64.22.121.161/rtm/signargs/";

	for(var el in args) { elArr.push(el); }
	elArr.sort();

	for(var i = 0; i < elArr.length; i++) {	normStr += elArr[i] + args[elArr[i]]; }
	log("normalized: " + normStr);
	/*
	use this code if you'd like to use the shared key in this file

	normStr = String(gRTMShared + normStr);
	var sig = String(hex_md5(normStr));
	*/

	/*
	otherwise, the following code does a fine job of generating a signature remotely
	*/
	var sig = $.ajax({
		url: url,
		data: {args: normStr},
		error: function (req, stat, exc) {
			log("<span class='error'>ERROR: " + String(req) + "<br/>" + stat + "</span>");
		}
	}).responseText;
	log("ajax response: " + sig);
	sig = eval(sig).md5.hash;
	/*
	end ajax code 
	*/

	log("api_sig: " + sig);

	args.api_sig = sig;
};


/********
misc utility functions
*********/
var toggleDebugDisplay = function (e) {
	var displayAttr = ($("#debugChk").attr("value") == "on") ? "block" : "none";

	$("#evenMore").css("display", displayAttr);
};

var log = function(s) {
	$("#evenMore").html($("#evenMore").html() + "<br/>" + String(s));
};

var openAuthUrl = function (e) {
	var authUrl = gRTMAuthUrl;
	var frobStr = rtmGetFrob();
	var args = {api_key: gRTMAPIKey, perms: "delete", frob: frobStr};

	rtmSign(args); 
	authUrl += "?api_key=" + gRTMAPIKey + "&perms=" + args.perms + "&frob=" + args.frob + "&api_sig=" + args.api_sig;

	if(window.widget) {
		log("opening "  + authUrl);
		widget.openURL(authUrl);
	} else {
		log("would've opened this url: " + authUrl);
	}
};


/*******
main setup function
********/
var setup = function () {
	log("got something on setup");
	$("#showprefsbtn").click(showPrefs);
	$("#hideprefsbtn").click(hidePrefs);
	$.ajaxSetup({
		async:false,
		type:"GET"
	});

	if (window.widget) {
		widget.onshow = populateTasks;
		widget.onhide = function () { };
		if(widget.preferenceForKey("authtoken") != "undefined") gRTMAuthToken = widget.preferenceForKey("authtoken");
		//gClearAuthBtn = new AppleGlassButton ($("#clearAuthBtn"), "Deauthorize this widgeroo", clearAuthTokens);
	}
	$("#clearAuthBtn").click(clearAuthTokens);
	$("#methodInfoBtn").click(getMethodInfo);
	$("#debugChk").click(toggleDebugDisplay);

	//testLogin();

	//if (typeof(window.widget) == "undefined") populateTasks();
};
$(setup);


/*
testing functions, ignore
*/
var testLogin = function () {
	var args = {
		method: "rtm.timelines.create",
		api_key: gRTMAPIKey
	};
	rtmSign(args);
	var res = rtmAjax(gRTMMethUrl, args);
	log("timeline res: " + res);
};

