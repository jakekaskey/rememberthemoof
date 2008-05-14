/*
Remember The Moof
Copyright 2008 Malcolm McFarland
http://code.google.com/p/rememberthemoof/

A Mac OS X Dashboard interface to Remember the Milk
(http://www.rememberthemilk.com/)

This code is released under both the MIT and GPL licenses.
*/

/*
this stuff is for when I start snazzing this up apple-style
*/
var gInfoBtn;

/*  
use me if you want to experiment locally, but be sure to uncomment the related code
elsewhere

var gRTMShared = ""; 
*/
var gRTMAPIKey = "87b748d22dca6a95a2674048ea627c76";
var gRTMAuthUrl = "http://www.rememberthemilk.com/services/auth/";
var gRTMMethUrl = "http://api.rememberthemilk.com/services/rest/";
var gRTMAuthToken;
var gRTMUserId;
var gRTMTimelineId = -1;
var gLastTransId = "0";
var gCurrentList = 0;
var gUndoTimerId;

/*
Hey, *here's* something for i18n!
*/
var gMonths = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

var showPrefs = function () { 
	if(window.widget)
		widget.prepareForTransition("ToBack");
	$("#front").hide();
	$("#back").show();

	if(window.widget)
		setTimeout('widget.performTransition();', 0);

	return false;
};
var hidePrefs = function () {
	if(window.widget)
		widget.prepareForTransition("ToFront");
	$("#back").hide();
	$("#front").show();
	if(window.widget)
		setTimeout('widget.performTransition();', 0);

	return false;
};

var markTaskDone = function (e) {
	var attrs = e.target.id.split("_");
	var args = {
		list_id: attrs[1],
		taskseries_id: attrs[2],
		task_id: attrs[3],
		timeline: rtmTimeline()
	};

	e.target.disabled = true;
	log("marking " + attrs[3] + " as complete");
	for (var i in args) log(i + ": " + args[i]);

	var res = rtmCall("rtm.tasks.complete", args);
	log("task marking response: " + res.data);

	if(res.stat == "failure") {
		log("failed marking task_id " + args.task_id + " done");
		e.target.disabled = false;
		return;
	}

	res = eval(res.data);
	if (res.rsp.transaction.undoable == "1") {
		prepUndo(res.rsp.transaction.id);
	}
	log(args.task_id + " marked done");

	window.setTimeout(populateTasks, 100);
};

/*
singleton for generating a timeline id
*/
var rtmTimeline = function () {
	if(gRTMTimelineId < 0 || isNaN(gRTMTimelineId)) {
		var res = rtmCall("rtm.timelines.create", null);

		if(res.stat == "failure")
			log("couldn't get timeline: " + res.data);
		res = eval(res.data);

		gRTMTimelineId = Number(res.rsp.timeline);
	}

	return String(gRTMTimelineId);
};

/*
method to fill out the task list

NOTE: this *sorely* needs refactoring...
*/
var populateTasks = function (killearly) {
	log("populating tasks");

	var list_id = gCurrentList;
	log("list_id: " + String(list_id));

	var arguments = {};
	if(isNaN(list_id) == false && Number(list_id) > 0)
		arguments.list_id = String(list_id);

	var tasks = rtmCall("rtm.tasks.getList", arguments, true);

	if(tasks.stat == "failure" || $(tasks.data).children("rsp").children("tasks").length < 1)
		return;
	tasks = tasks.data;
	//if(typeof(killearly) != "undefined" && killearly == true) return;
	

	/*
	first, clean up list
	*/
	$("#taskList").empty();

	var lists = $(tasks).children("rsp").children("tasks").children("list").get(); //.children("taskseries").filter("task:first").get();
	var cur_list;
	var ts_list;
	var cur_ts;
	var cur_task;
	var task_list = [];
	var cur_list_id;
	var task_obj;
	var task;
	// log("======================\nparsing lists:");
	for(var l in lists) {	
		cur_list = $(lists[l]);
		cur_list_id = cur_list.attr("id");
		// log("parsing cur_list_id " + cur_list_id);
		ts_list = cur_list.children("taskseries").get();
		for(var ts_ind in ts_list) {
			cur_ts = $(ts_list[ts_ind]);
			// log("looking at taskseries " + cur_ts.attr("name"));
			cur_task = cur_ts.children("task:first");
			if(typeof(cur_task.attr("completed")) == "undefined" && typeof(cur_task.attr("delete")) == "undefined") {
				// log("valid task '" + cur_ts.attr("name") + "'");
				task_obj = {
					list_id: cur_list_id,
					name: cur_ts.attr("name"),
					ts_id: cur_ts.attr("id"),
					task_id: cur_task.attr("id"),
					due: parseRTMDate(cur_task.attr("due"), (cur_task.attr("has_due_time") == "1"))
				};
				task_list.push({due:cur_task.attr("due"), task:task_obj});
			}
		}
	}

	if(lists.length > 0) {
		task_list.sort(rtmDueSort);
	} else {
		task_list.reverse(); // RTM sends us most recent first, we want the opposite
	}
	$.each(task_list, addTaskToList);

	/*
	this only matters the first time, but it'd be *really* nice to have it in some sort of
	chained-function capability (chain it in the setup routine)....
	*/
	$("#splashSection").hide();
	$("#taskSection").show();
	$("#showprefsbtn").show();
//	$("#listid").html(tasks.list.id);
};

/*
compare function for sorting {due:due, task:cur_task}
*/
var rtmDueSort = function(task1, task2) {
	if(typeof(task1.due) == "undefined" ) {
		if(typeof(task2.due) == "undefined") {
			/* 
			sort lexicographically
			*/
			return ((task1.task.name[0].toLowerCase() == task2.task.name[0].toLowerCase()) ? 0 :
					((task1.task.name[0].toLowerCase() < task2.task.name[0].toLowerCase()) ? -1 : 1))
		} else {
			/*
			undefined's take precedence
			*/
			return -1
		}
	} else {
		if(typeof(task2.due) == "undefined") {
			return 1;
		}
	}

	/*
	undefined's are out of the way, now actually sort the dates
	*/
	var task1_date = rtmNormalizeDateStr(String(task1.due));
	var task2_date = rtmNormalizeDateStr(String(task2.due));
	return ((task1_date.getTime() == task2_date.getTime()) ? 0 :
			((task1_date.getTime() < task2_date.getTime()) ? -1 : 1));
};
/*
creates a list item for a task, called mainly from populateTasks()
*/
var addTaskToList = function() {  // this == {due:[due, has_due_time] task:{list_id, name, ts_id, task_id, due}}
	/*log("addtasktolist this: " + String(this));
	for(var k in this) {
		log("addtasktolist: this[" + k + "] == " + this[k]);
	}*/
	var cur_task = this.task;
	var newItem = $("#itemTemplate").clone();

	var list_id = String(cur_task.list_id);
	var taskseries_id = String(cur_task.ts_id);
	var task_id = String(cur_task.task_id);
	var name = String(cur_task.name).replace("<", "&lt;", "g").replace(">", "&gt;", "g");
	var due = String(cur_task.due);

	//log("filling in newItem values");
	newItem.children(".title:first").html(name);
	newItem.children(".due:first").html(due);
	newItem.children(".task_chk:first").attr("name", "taskchk_" + list_id + "_" + taskseries_id + "_" + task_id);
	newItem.children(".task_chk:first").attr("id", "taskchk_" + list_id + "_" + taskseries_id + "_" + task_id);
	newItem.children(".task_chk:first").change(markTaskDone);
	//log("appending newItem");
	$("#taskList").append(newItem);
	//log("showing newItem");

	newItem.show();
	
	log("appended item " + name + ", due " + due + " with id " + task_id);
};

var populateLists = function () {
	log("populating lists popup");
	//gCurrentList = Number($("#lists").get(0).options[$("#lists").get(0).selectedIndex].id.split("_")[1]);
	$("#lists").empty();

	addListItem(-1, {name: "All", id: "-1"});

	var lists = rtmCall("rtm.lists.getList", null, true);

	if(lists.stat == "failure" || $(lists.data).children("rsp").children("lists").length < 1)
		return;
	lists = $(lists.data).children("rsp:first");

	log("initial list: " + String(gCurrentList));


	lists.children("lists").children("list").each(addListItem);

	for(var i = 0; i < $("#lists").get(0).options.length; i++) {
		log("checking list " + $("#lists").get(0).options[i].id);
		if(Number($("#lists").get(0).options[i].id.split("_")[1]) == gCurrentList)
			$("#lists").get(0).selectedIndex = i;
	}
	
	//linkManip($("#showNewTaskPane").get(0), true);
	//$("#showNewTaskPane").children("a:first").click(setupNewTaskPane);
	$("#showNewTaskPane").children(".nolink:first").hide();
	$("#showNewTaskPane").children("a:first").show();

	$("#listsSection").show();
	//addListItem(lists[l].id, lists[l].name);
};

var addListItem = function (i, data) {
	/*
	$(..).each(func()) places the target element in 'this'
	*/
	log("adding a list with id " + String(i));
	if(typeof(data) != "undefined") {
		var name = data.name;
		var id = data.id;
	} else {
		var name = $(this).attr("name");
		var id = $(this).children("task:first").attr("id");
	}

	var newListItem = "<option id='list_" + String(id) +"' name='' value='' class='list_option'><span class='title'>" + String(name) + "</span></option>";

	//log("adding list item: " + String(newListItem).replace("&", "&amp;", "g").replace("<", "&lt;", "g").replace(">", "&gt;", "g"));

	$("#lists").append(newListItem);
};

var loadNewList = function (e) {
	var newlist = Number($("#lists").get(0).options[$("#lists").get(0).selectedIndex].id.split("_")[1]);

	if(newlist == gCurrentList)
		return
	
	log("loading new list: " + newlist);

	gCurrentList = newlist;

	populateTasks();
};

var buildFront = function () {
	log("building front");
	populateLists();
	populateTasks();

	if(gUndoTimerId != null) {
		window.clearTimeout(gUndoTimerId);
		gUndoTimerId = null;
	}
	$("#undoBtn").hide();

	return;
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
the interface to RTM; checks authentication, makes sure args are signed, etc

this method automatically fills in:

 - api_key
 - method
 - format == json

*/
var rtmCall = function (methName, args, xml) { 
	var ajaxArgs = (args == null) ? {} : args;
	var asXML = (typeof(xml) == "undefined") ? false : true;
	
	/*
	first check token status

	make sure we don't call getToken before we're authorized, or RTM will invalidate
	the frob (and it's a pain to reset)
	*/
	if(!checkHaveFrob()) {
		/*
		don't have a frob, so assume we haven't tried authenticating
		*/
		clearAuthTokens();
		$("#needToAuth").show();
		$("#needToAuth a:first").click(openAuthUrl);

		return {stat: "failure", data: "need token"};
	}

	/* 
	good -- we have a frob, so assume that we're authenticated, and just need to get
	our token (and please be correct)
	*/
	if(gRTMAuthToken == null || gRTMAuthToken == "")
		if(rtmAuth() == false)
			return {stat: "failure", data: "token acquire failed"};
	
	/*
	ok; we have a token, let's check that it works, ahright?
	*/
	var tokGood = eval(rtmAjax(gRTMMethUrl, {method: "rtm.auth.checkToken"}));
	if(tokGood.rsp.stat == "fail" && tokGood.rsp.err.code == "98") {
		log("token bogus, need to regen");
		if(!regenToken())
			return {stat: "failure", data: "couldn't regen token for some reason"};
	}
	else if(tokGood.rsp.stat == "fail")
		return {stat: "failure", data: tokGood.rsp.err.code + ": " + tokGood.rsp.err.msg};
	
	/*
	if we successfully navigated the token auth retrieval labyrinth...
	*/

	$("#needToAuth").hide(); // just in case

	ajaxArgs.method = methName;

	return {stat: "success", data: rtmAjax(gRTMMethUrl, ajaxArgs, asXML)};
};

var regenToken = function () {
	log("getting fresh token");

	gRTMAuthToken = "";
	
	widget.setPreferenceForKey(null, "frob");
	widget.setPreferenceForKey(null, "authtoken");
	
	var regenArgs = {method: "rtm.auth.getToken", frob: rtmGetFrob()};
	var res = rtmAjax(gRTMMethUrl, regenArgs);

	log("regen token result: " + res);
	res = eval(res);
	if(res.rsp.stat == "fail") {
		log("regen failed: error " + res.rsp.err.code + ", " + res.rsp.err.msg);
		return false;
	}

	gRTMAuthToken = ret.auth.token;
	widget.setPreferenceForKey(ret.auth.token, "authtoken");

	return true;
};

/*
a singleton message for the frob item
*/
var rtmGetFrob = function () {
	if(checkHaveFrob()) {
		log ("returning frob: " + String(widget.preferenceForKey("frob")));
		return widget.preferenceForKey("frob");
	}

	/*
	need a new frob
	*/
	var frobArgs = {method: "rtm.auth.getFrob", api_key: gRTMAPIKey, format: "json"};
	var frobRet = eval(rtmAjax(gRTMMethUrl, frobArgs));
	log("frob from server: " + frobRet.rsp.frob);

	if(frobRet.rsp.stat == "ok") {
		if(window.widget) widget.setPreferenceForKey(frobRet.rsp.frob, "frob");

		return frobRet.rsp.frob;
	} else {
		return "failure";
	}
};

/*
check our frob status
*/
var checkHaveFrob = function () {
	if (!window.widget)
		return false;

	return (widget.preferenceForKey("frob") != "undefined" && typeof(widget.preferenceForKey("frob")) != "undefined");
};

var rtmAuth = function () {
	if(!checkHaveFrob())
		return false;
	
	var args = {method:"rtm.auth.getToken", api_key:gRTMAPIKey, frob:rtmGetFrob(), format: "json"};
	var ret = rtmAjax(gRTMMethUrl, args);
	log("getToken response: " + ret);

	ret = eval(ret);
	
	/*
	just for testing:
	*/
	if(typeof(ret.rsp) != "undefined")
		ret = ret.rsp;

	if(typeof(ret.auth.token) == "undefined")
		return false;

	gRTMAuthToken = ret.auth.token;
	gRTMUserId = ret.auth.user.id;

	if(window.widget) {
		widget.setPreferenceForKey(gRTMAuthToken, "authtoken");
		widget.setPreferenceForKey(gRTMUserId, "userid");
		widget.setPreferenceForKey(ret.auth.user.username, "username");
		widget.setPreferenceForKey(ret.auth.user.fullname, "fullname");
		widget.setPreferenceForKey(ret.auth.perms, "perms");
	}
	
	return true;
};

/*
the interface that actually takes care of doing the AJAX call
*/
var rtmAjax = function (url, data, asXML) {
	if(typeof(data) != "object") return "Need a data object";
	if(typeof(data.method) == "undefined") return "Need a method name";

	show_waiting(true);
//	$("#undoPane").hide();

	data.api_key = gRTMAPIKey;
	data.format = (asXML == true) ? "rest" : "json";
	if(gRTMAuthToken != null && gRTMAuthToken.length > 0) data.auth_token = gRTMAuthToken;
	rtmSign(data);

	var retVal = $.ajax({
		url: url,
		data: data,
		error: function (req, stat, exc) {
			log("<span class='error'>ERROR: " + String(req) + "<br/>" + stat + "</span>");
		}
	});

	show_waiting(false);
	return (asXML == true) ? retVal.responseXML : retVal.responseText;
};

/*
utility function to clean house on authorization tokens
*/
var clearAuthTokens = function (e) {
	if(window.widget) {
		widget.setPreferenceForKey(null, "frob");
		widget.setPreferenceForKey(null, "authtoken");
	}

	gRTMAuthToken = "";

	log('auth tokens cleared');

	return false;
};

/*
this is for showing and setting up the Add Task panel
*/
var setupNewTaskPane = function (e) {
	$("#newTaskName").val("");
	$("#newTaskDueDate").val("");
	$("#newTaskList").empty();

	var new_lists = $("#lists").clone().get(0);
	new_lists.id =  "newTaskList_list";
	
	/*
	TESTING: filter out lists that aren't real (i.e., "All")
	*/
	log(new_lists.options.length + " items to check");
	for(var l = 0; l < new_lists.options.length; l++) {
		log("l == " + l);
		if(typeof(new_lists.options[l]) != "object") {
			log("strange; type is " + typeof(new_lists.options[l]) + " with a value of " + new_lists.options[l]);
			continue;
		}
		log("checking list item: " + new_lists.options[l].id);
		if(Number(new_lists.options[l].id.split("_")[1]) < 1) {
			var rem_opt = new_lists.removeChild(new_lists.options[l]);
			log("removed item: " + rem_opt.id);
		} else if(Number(new_lists.options[l].id.split("_")[1]) == gCurrentList) {
			new_lists.selectedIndex = l;
		}
	}

	log("resulting new_lists size: " + new_lists.options.length);
	if(new_lists.options.length < 1)
		new_lists.disabled = true;

	$("#newTaskList").append(new_lists);

	$("#newTaskSubmit").attr("disabled", true);

	$("#addTask").css("top", $("#showNewTaskPane").offset().top + $("#showNewTaskPane").get(0).offsetHeight);
	$("#addTask").slideDown(100);
	//$("#showNewTaskPane").attr("disabled", true);
	//linkManip($("#showNewTaskPane").get(0), false);
	$("#showNewTaskPane").children(".nolink:first").show();
	$("#showNewTaskPane").children("a:first").hide();

	return false;
};

var hideNewTaskPane = function (e) {
	//$("#addTask").hide();
	$("#addTask").slideUp(100);
	//linkManip($("#showNewTaskPane").get(0), true);
	$("#showNewTaskPane").children(".nolink:first").hide();
	$("#showNewTaskPane").children("a:first").show();
	//$("#showNewTaskPane").children("a:first").click(setupNewTaskPane);

	return false;
};

var updateNewTaskPane = function (e) {
	if($("#newTaskName").val().length > 0)
		$("#newTaskSubmit").attr("disabled", false);
	else
		$("#newTaskSubmit").attr("disabled", true);
		
	return false;
};

var addNewTask = function (e) {
	log("new task name: " + $("#newTaskName").val());

	var args = {name: $("#newTaskName").val(), timeline: rtmTimeline()};
	if($("#newTaskDueDate").val().length > 0) {
		args.name = args.name + " " + $("#newTaskDueDate").val();
		args.parse = "1";
	}
	var sel_list_id = $("#newTaskList_list").get(0).options[$("#newTaskList_list").get(0).selectedIndex].id.split("_")[1];
	if(Number(sel_list_id) > 0) {
		args.list_id = String(sel_list_id);
	}
	
	/*
	args.name = String(args.name).replace(/[?<>&;:@=]/, function(s) { return escape(s); }); 
	args.name = String(args.name).replace("/", "%2F", "g");
	args.name = String(args.name).replace(">", "%3E", "g");
	*/
	rtmCall("rtm.tasks.add", args);

	hideNewTaskPane();
	window.setTimeout(populateTasks, 100);
};

var prepUndo = function(id) {
	gLastTransId = id;

	$("#undoPane").show();
	if(gUndoTimerId != null) {
		window.clearTimeout(gUndoTimerId);
	}

	gUndoTimerId = window.setTimeout(function() { $("#undoPane").hide(); gUndoTimerId = null; }, 30000);	
};

var doUndo = function(e) {
	if(Number(gLastTransId) < 1)
		return;
	var args = {
		transaction_id: String(gLastTransId),
		timeline: rtmTimeline()
	};
		
	var res = rtmCall("rtm.transactions.undo", args);
	$("#undoPane").hide();

	window.setTimeout(populateTasks, 100);

	return false;
};


/*
method arguments signing function
*/
var rtmSign = function (args) {
	var elArr = [];
	var normStr = "";
	// add port 786 (port RTM)
	var url = "http://64.22.121.161:8786/signargs/";

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
	log("sending off for hash...");
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
	if($("#debugChk").attr("value") == "on") {
		$("#evenMore").show();
		log = oldlog;
		log("showing debug dialog");
	} else {
		$("#evenMore").hide();
		log("debug dialog hidden");
		log = function(s) { return; };
	}

	return false;
};

var log = function(s) { };   // this will be swapped out, depending on if the debugChk is set
var oldlog = function(s) {
	$("#evenMore").html($("#evenMore").html() + "\n" + String(s));
};

var rtmNormalizeDateStr = function (datestr) {
	var time = String(datestr.split("T")[1]).replace("Z", "");
	var date = datestr.split("T")[0];
	return new Date(date.split("-")[0],
				Number(date.split("-")[1]) - 1,
				date.split("-")[2],
				time.split(":")[0],
				time.split(":")[1],
				time.split(":")[2]);
};
var parseRTMDate = function(d, has_due_time) {
	if (typeof(d) == "undefined" || d == "undefined" || d == "") return "";

	var new_date = rtmNormalizeDateStr(d);
	var now_date = new Date();

	/* 
	timezone compensation upfront; javascript automatically rolls back date, month, year
	*/
	new_date.setHours(new_date.getHours() - (new_date.getTimezoneOffset()/60));

	var date_str;
	if(new_date.getYear() == now_date.getYear() &&
			new_date.getMonth() == now_date.getMonth() &&
			new_date.getDay() == now_date.getDay()
			) {
		date_str = "Today";
	} else if((new_date.getYear() == now_date.getYear() &&
				new_date.getMonth() == now_date.getMonth() &&
				new_date.getDay() == now_date.getDay() + 1) ||
			(new_date.getYear() == now_date.getYear() &&
				new_date.getMonth() == now_date.getMonth() + 1 &&
				new_date.getDay() == 1)) {
		date_str = "Tomorrow";
	} else {
		date_str = String(new_date.getDate()) + " " + gMonths[new_date.getMonth()] + " " + String(new_date.getFullYear());
	}

	if(has_due_time) {
		var minutes = (new_date.getMinutes() < 10) ? "0" + String(new_date.getMinutes()) : String(new_date.getMinutes());
		var hours = (new_date.getHours() < 10) ? "0" + String(new_date.getHours()) : String(new_date.getHours());
		/*if(hours < 0)
			hours += 24;*/

		date_str += " at " + hours + minutes;
	}

	return date_str;
};

var openAuthUrl = function (e) {
	var authUrl = gRTMAuthUrl + "?";
	var frobStr = rtmGetFrob();
	var args = {api_key: gRTMAPIKey, perms: "delete", frob: frobStr};

	rtmSign(args); 
	for(var a in args) {
		authUrl += a + "=" + args[a] + "&";
	}
	//authUrl += "?api_key=" + gRTMAPIKey + "&perms=" + args.perms + "&frob=" + args.frob + "&api_sig=" + args.api_sig;

	if(window.widget) {
		log("opening "  + authUrl);
		widget.openURL(authUrl);
	} else {
		log("would've opened this url: " + authUrl);
	}

	return false;
};

var goToRTM = function(e) {
	if(window.widget) {
		widget.openURL("http://www.rememberthemilk.com/");
	}

	return false;
};
var goToProject = function(e) {
	if(window.widget) {
		widget.openURL("http://code.google.com/p/rememberthemoof");
	}

	return false;
};

var show_waiting = function (show) {
	document.getElementById("waitIcon").style.display = (show == true) ? "block" : "none";
};

/*
for gratuitous using of <a href> tags as functional units, shame on me

	<span .. >link text</span>  <<==>>  <span .. ><a href=".">link text</span>
*/
var linkManip  = function (el, makeLink) {
	if(makeLink) {
		log("text ==> link");
		/*var new_anchor = document.createElement("a");
		new_anchor.setAttribute("href", "");
		$(el).wrapInner(new_anchor);*/
		var new_innards = "<a href=''>" + $(el).html() + "</a>";
		$(el).html(new_innards);
		log("el innards: " + $(el).html());
	} else {
		log("link ==> text");
		var innards = $(el).children("a:first").text();
		log("link innards: " + innards);
		$(el).text(innards);
	}
};


/*******
main setup function
********/
var setup = function () {
	log("entering setup");

	$.ajaxSetup({
		async:false,
		type:"GET",
		beforeSend: function (req) { req.setRequestHeader("Cache-Control", "no-cache");  }
	});

	if (window.widget) {
		widget.onshow = buildFront;
		widget.onhide = function () { };
		if(widget.preferenceForKey("authtoken") != "undefined" &&
				typeof(widget.preferenceForKey("authtoken")) != "undefined") {
			gRTMAuthToken = widget.preferenceForKey("authtoken");
			log("retrieved authtoken: " + gRTMAuthToken);
		}

		/*
		apple-gooey setup here
		*/
		//gInfoBtn = new AppleInfoButton(document.getElementById("showprefsbtn"), document.getElementById("infowrapper"), "white", "white", showPrefs);
	}
	
	/*
	connect all of the events
	*/
	$("#showprefsbtn").click(showPrefs);
	$("#hideprefsbtn").click(hidePrefs);
	$("#goToRTM").click(goToRTM);
	$("#goToProject").click(goToProject);
	
	$("#clearAuthBtn").click(clearAuthTokens);
	$("#methodInfoBtn").click(getMethodInfo);
	$("#getnewfrob").click(getFrobTest);
	$("#debugChk").click(toggleDebugDisplay);
	$("#lists").change(loadNewList);
	$("#undoBtn").click(doUndo);

	$("#newTaskCancel").click(hideNewTaskPane);
	$("#newTaskSubmit").click(addNewTask);
	$("#newTaskName").keyup(updateNewTaskPane);
	$("#showNewTaskPane").children("a").click(setupNewTaskPane);

	if(!window.widget) {
		$(".hideOnLoad").show();
		buildFront();
		$("body").css("background-color", "#000044'");
	}
	
	log("setup done");
	//testLogin();

	//if (typeof(window.widget) == "undefined") populateTasks();
};
$(setup);


/*
testing functions, ignore
*/
var getFrobTest = function () {
	var frobArgs = {method: "rtm.auth.getFrob", api_key: gRTMAPIKey, format: "json"};
	
	$("#methodDisp").html(String(rtmAjax(gRTMMethUrl, frobArgs)).replace("<", "&lt;","g").replace(">", "&gt;","g"));
};
