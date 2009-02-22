/*
Remember The Moof
Copyright 2008 Malcolm McFarland
http://code.google.com/p/rememberthemoof/

A Mac OS X Dashboard interface to Remember the Milk
(http://www.rememberthemilk.com/)

This code is released under both the MIT and GPL licenses.
*/

const kNoListId = 0;

/*
global handles to some widget elements
*/
var gInfoBtn;
var gDoneBtn;

/*  
use me if you want to experiment locally, but be sure to uncomment the related code
elsewhere

var gRTMShared = ""; 
*/
var gRTMAPIKey = "87b748d22dca6a95a2674048ea627c76";
var gRTMAuthUrl = "http://www.rememberthemilk.com/services/auth/";
var gRTMMethUrl = "http://api.rememberthemilk.com/services/rest/";
var gRTMSignHost = "rtmoof.appspot.com";
var gRTMSignPath = "sign/";
var gRTMAuthToken;
var gRTMUserId;
var gRTMTimelineId = -1;
var gCurrentList = kNoListId;
var gCurrentTag = null;
var gUndoStack = [];  // [[timer_id, trans_id], ..]
var gOverlays = [];

var gStatusWinTimer = null;
var gGlobalSyncQueue = [];  // *very* crude synchronization, for when we don't want functions stepping on each other's toes

/*
a counting semaphore, controlling progress where multiple asynchronous calls are concerned
*/
var gInProgress;

/*
Hey, *here's* something for i18n!
*/
var gMonths = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
var gDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

var gLang = "en";
var gStatMsgs = { en : {
			setting_up : "Setting up widget",
			building_front : "Building interface",
			getting_lists : "Getting lists",
			getting_tasks : "Getting tasks",
			build_tag_list : "Associating tags",
			vers_check : "Checking version"
			} };
/*
miscellaneous
*/
var gDEBUG = false;
var gAppVersion = "emu_rc1";
var gCountsBetweenVersionChecks = 10;

/* defaults, reset by server
 *
 * not the best way to set these, but this whole code base could stand to 
 * be more modular
 */
var gServerVer = gAppVersion;
var gServerUrl = "http://www.hoprocker.net/rtm/";

var showPrefs = function () { 
	if(window.widget)
		widget.prepareForTransition("ToBack");
	$("#front").hide();
	$("#back").show();

	if(window.widget)
		window.setTimeout('widget.performTransition();', 0);

	return false;
};
var hidePrefs = function () {
	if(window.widget)
		widget.prepareForTransition("ToFront");
	$("#back").hide();
	$("#front").show();
	if(window.widget)
		window.setTimeout('widget.performTransition();', 0);
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

	res = eval("(" + res.data + ")");
	if (res.rsp.transaction.undoable == "1") {
		prepUndo(res.rsp.transaction.id);
	}
	log(args.task_id + " marked done");

	populateTasks();
};

/*
singleton for generating a timeline id
*/
var rtmTimeline = function () {
	if(gRTMTimelineId < 0 || isNaN(gRTMTimelineId)) {
		var res = rtmCall("rtm.timelines.create", null);

		if(res.stat == "failure")
			log("couldn't get timeline: " + res.data);
		res = eval("(" + res.data + ")");

		gRTMTimelineId = Number(res.rsp.timeline);
	}

	return String(gRTMTimelineId);
};

/*
methods to fill out the task list

NOTE: this *sorely* needs refactoring...
*/
var populateTasks = function ( synchronized ) {
	statMsg( "getting_tasks" );
	log("populating tasks");
	show_waiting(true);

	var list_id = gCurrentList;
	log("list_id: " + String(list_id));

	var call_args = {};
	if(isNaN(list_id) == false && Number(list_id) > 0)
		call_args.list_id = String(list_id);

//	var tasks = rtmCall("rtm.tasks.getList", arguments, true);
	rtmCallAsync ("rtm.tasks.getList", call_args, true, populateTasksContinue.curry( synchronized ) );
};

var populateTasksContinue = function ( synchronized, tasks) {
	if(tasks.stat == "failure" || $(tasks.data).children("rsp").children("tasks").length < 1)
		return;
	tasks = tasks.data;

	/*
	first, clean up list
	*/
	$("#taskList").empty();

	var lists = $(tasks).children("rsp").children("tasks").children("list").get(); //.children("taskseries").filter("task:first").get();
	var cur_list;
	var ts_list;
	var tags;
	var cur_ts;
	var cur_task;
	var cur_tag;
	var task_list = [];
	var cur_list_id;
	var task_obj;
	var task;
	var allTags = [];
	// log("======================\nparsing lists:");
	for(var l in lists) {	
		cur_list = $(lists[l]);
		cur_list_id = cur_list.attr("id");
		// log("parsing cur_list_id " + cur_list_id);
		ts_list = cur_list.children("taskseries").get();
		for(var ts_ind in ts_list) {
			cur_ts = $(ts_list[ts_ind]);
			tags = [];
			// log("looking at taskseries " + cur_ts.attr("name"));
			// log("cur_ts: " + cur_ts.text());
			cur_task = cur_ts.children("task:first");
			if(typeof(cur_task.attr("completed")) == "undefined" && typeof(cur_task.attr("delete")) == "undefined") {
				// log("valid task '" + cur_ts.attr("name") + "'");
				var pos_tags = cur_ts.children("tags").children("tag");
				if(pos_tags.length > 0) {
					for(var t in pos_tags.get()) {
						var cur_tag = $(pos_tags.get()[t]).text();
						log("fetching tag " + String(t) + ", " + cur_tag);
						tags.push(cur_tag);
						if($.inArray(cur_tag, allTags) < 0)
							allTags.push(cur_tag);
					}
					log("tags: " + tags)
				}
				task_obj = {
					list_id: cur_list_id,
					name: cur_ts.attr("name"),
					ts_id: cur_ts.attr("id"),
					task_id: cur_task.attr("id"),
					tags: tags.join(","),
					prio: ( cur_task.attr( "priority" ) == "N" ) ? 4 : Number( cur_task.attr( "priority" ) ),
					due: parseRTMDate(cur_task.attr("due"), (cur_task.attr("has_due_time") == "1"))
				};
				task_list.push({due:cur_task.attr("due"), task:task_obj});
			}
		}
	}

	if(lists.length > 0) {
		log("more than one list at once, sorting");
		task_list.sort(rtmTaskSort);
	} else {
		task_list.reverse(); // RTM sends us most recent first, we want the opposite
	}
	$.each(task_list, addTaskToList);

	/*
	tag setup
	*/
	refreshTagList(allTags);
	$("#tagList").hide();

	/*
	this only matters the first time, so it'd be *really* nice to have it in some sort of
	chained-function capability (chain it in the setup routine)....
	*/
	show_waiting(false);
	$("#splashSection").remove();
	$("#taskSection").show();
	$(".taskEdit").click(setupTaskPane);

	makeWindowFit($("#front"));
	hideStat();

	if( synchronized && gGlobalSyncQueue.length > 0 )
		gGlobalSyncQueue.shift()();
//	$("#listid").html(tasks.list.id);
	//log("taskList has " + $("#taskList").children("li").length + " children");
};

/*
creates a list item for a task, called mainly from populateTasks()
*/
var addTaskToList = function(iter) {  // this == {due:due task:{list_id, name, ts_id, task_id, tags, prio, due}}
	var cur_task = this.task;
	var newItem = $("#itemTemplate").clone();
	newItem.removeAttr("id"); // make sure this isn't the one used in subsequent clones!
	newItem.attr( "dueval", this.due );

	var list_id = String(cur_task.list_id);
	var taskseries_id = String(cur_task.ts_id);
	var task_id = String(cur_task.task_id);
	var tags = cur_task.tags;
	var name = String(cur_task.name).replace("<", "&lt;", "g").replace(">", "&gt;", "g");
	var priority = String( cur_task.prio );
	var due = String(cur_task.due);

	newItem.children(".title").append($("<a href='' class='taskEdit'>" + name + "</a>"));
	newItem.children(".due").html(due);
	if( $.inArray( priority, [ "1", "2", "3" ] ) > -1 )
		newItem.addClass( "priowrap" + priority + " hasPrio" );
	newItem.children(".tags").html(tags);
	newItem.children(".task_chk").attr("name", "taskchk_" + list_id + "_" + taskseries_id + "_" + task_id);
	newItem.children(".task_chk").attr("id", "taskchk_" + list_id + "_" + taskseries_id + "_" + task_id);
	newItem.children(".task_chk").change(markTaskDone);
	if(tags.split(",").length > 0 && tags.split(",")[0].length > 0) {
		for(var t in tags.split(",")) {
			log("adding tag tag_" + tags.split(",")[t] + " to item " + name);
			newItem.addClass("tag_" + tags.split(",")[t]);
		}
		log("total class value for " + name + ": " + newItem.attr("class"));
	}
		
	$("#taskList").append(newItem);

	newItem.show();
	
	log("appended item " + name + ", due " + due + " with id " + task_id);
};

/*
refresh the tag list at top after repopulating task list
*/
var refreshTagList = function (tags) {
	statMsg( "build_tag_list" );
	log("refreshing tag list");
	$("ul", "#tagList").empty();
	addTagListItem.call(String("all"));

	$.each(tags, addTagListItem);

	if( gCurrentTag != null && tags.length > 0 ) 
		for( var i in tags )
			if( gCurrentTag == tags[i] ) {
				log( "showing only tag --> " + gCurrentTag );
				tagShowOnly( gCurrentTag );
			}
	hideStat();
	log("tag list refreshed");
};

/*
create/append new tag list item
*/
var addTagListItem = function () {
	var name = this;
	var newli = $("#tagListTemplate").clone().empty();
	log("adding " + name + " to tag list");

	newli.attr("id", "tagList_" + name);
	newli.append($("<a href=''>" + name + "</a>"));
	newli.children("a").hover(tagListOver, tagListOut);
	newli.children("a").click(getTagClick);
	newli.show();

	$("ul", "#tagList").append(newli);
};

var tagListOver = function () { 
	var tagName = $(this).parent("li:first").attr("id").split("_")[1];

	$("#taskList > li").removeClass("hilite");
	if(tagName == "all") {
		log("showing all tasks");
		$("#taskList > li").addClass("hilite");
	} else {
		log("hiliting only tag: tag_" + tagName);
		log(String($("#taskList > li.tag_" + tagName).length) + " culprits found");
		$("#taskList > li.tag_" + tagName).each(function (i) {
				log("hiliting item " + String(i));
				log("adding hilite class to " + $(this).children(".title > a").text());
				$(this).addClass("hilite");
			} );
	}
};
var tagListOut = function () {
	return;
};
/*
filter items in the tasklist to only show ones with this tag
*/
var getTagClick = function ( e ) {
	var tagName = $(e.target).text();
	gCurrentTag = tagName;
	tagShowOnly( tagName );

	return false;
}
var tagShowOnly = function ( tagName ) {
	log("filter task items for tag " + tagName);

	$("#taskList > li").removeClass("hilite");
	if(tagName == "all") {
		$("#taskList > li").show();
	} else {
		$("#taskList > li").hide();
		$("#taskList > li.tag_" + tagName + "").each(function () {
				log("matched " + $(this).children("span.title").text());
				$(this).show();
			} );
	}

	$("#tagList").hide();

	makeWindowFit($("#front"));
};

/*
show list of tags when current tag label is clicked
*/
var doTagPop = function (e) {
	var parEl = this;
	log("showing tag list");

	//overlayHideAndSet("tagList");
	$("#tagList").css({top: $( parEl ).offset().top, left: $(parEl).offset().left});
	
	$("#tagList").slideDown(100, function () { makeWindowFit($("#front")); } );

	return false;
};


/*
start task list population
*/
var populateLists = function ( synchronized ) {
	statMsg( "getting_lists" );
	log("populating lists popup");
	show_waiting(true);
	//gCurrentList = Number($("#lists").get(0).options[$("#lists").get(0).selectedIndex].id.split("_")[1]);
	$("#lists").empty();

	addListItem(-1, {name: "All", id: "-1"});

	rtmCallAsync("rtm.lists.getList", null, true, populateListsContinue.curry( synchronized ) );
};

var populateListsContinue = function (synchronized, lists) {
	if(lists.stat == "failure" || $(lists.data).children("rsp").children("lists").length < 1)
		return;
	log("raw data: " + String(lists.data));
	lists = $(lists.data).children("rsp");

	log("initial list: " + String(gCurrentList));

	lists.children("lists").children("list").each(addListItem);

	for(var i = 0; i < $("#lists").get(0).options.length; i++) {
		debugLog("checking list " + $("#lists").get(0).options[i].id + ", " + $( "#lists" ).get(0).options[i].innerHTML );
		if(Number($("#lists").get(0).options[i].id.split("_")[1]) == gCurrentList)
			$("#lists").get(0).selectedIndex = i;
		else if ( gCurrentList == kNoListId && $( "#lists" ).get(0).options[i].innerHTML == "Inbox" ) {
			gCurrentList = $( "#lists" ).get(0).options[i].id.split( "_" )[1];
			$( "#lists" ).get(0).selectedIndex = i;
		}
	}
	
	show_waiting(false);
	$("#listsSection").show();

	hideStat();

	if( synchronized && gGlobalSyncQueue.length > 0 )
		gGlobalSyncQueue.shift()();
};

var addListItem = function (i, data) {
	/*
	$(..).each(func()) places the target element in 'this'
	*/
	log("adding a list with id " + String(i));

	if(typeof(data) != "undefined" && data != this) {  
		// if this function is called w/o a 'data' argument, then data is set to point to the object it's called with, i.e., this
		var name = data.name;
		var id = data.id;
	} else {
		for(var i in this.attributes) log("attribute: " + i + "::" + this.getAttribute(i));
		var name = $(this).attr("name");
		var id = $(this).attr("id");
	}

	name = String(name).replace("&", "&amp;", "g").replace("<", "&lt;", "g").replace(">", "&gt;", "g");
	id = String(id).replace("&", "&amp;", "g").replace("<", "&lt;", "g").replace(">", "&gt;", "g");
	log("list name & id: " + name + ", " + id);
	var newListItem = "<option id='list_" + String(id) + "' name='' value='' class='list_option'><span class='title'>" + String(name) + "</span></option>";

	log("adding list item " + name);
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
	if( checkHaveLocalFrob() ) {
		log("building front");

		// very, very crude synchronization
		gGlobalSyncQueue.push( populateLists.curry( true ) );
		gGlobalSyncQueue.push( populateTasks.curry( true ) ); 
		gGlobalSyncQueue.shift()();

		while(gUndoStack.length > 0) window.clearTimeout(gUndoStack.pop()[0]); // [[timer_id, trans_id], ..]

		$("#undoPane").hide();

		makeWindowFit($("#front"));
	} else {
		setupNewAuth();
	}

	checkVersionFunc( { 'ver' : gServerVer, 'url' : gServerUrl } );

	return;
};

/*
 * version tracking, gets latest version / download url from server (set in rtmSign())
 * {{{
 */
var checkVersionFunc = function( info ) {
	statMsg( "vers_check" );
	if( info[ 'ver' ] != gAppVersion && _isUpdatePopTime() ) {
		popUpdate( info[ 'ver' ], info[ 'url' ] );
	}
	hideStat();
};

var _isUpdatePopTime = function() {
	var newCnt = ( Number( widget.preferenceForKey( "versionCheckCounter" ) ) + 1 ) % gCountsBetweenVersionChecks;
	widget.setPreferenceForKey( newCnt, "versionCheckCounter");
	if( newCnt == 0 )
		return true;
	
	return false;
};

var popUpdate = function( ver, url ) {
	var goLnk = $( ".goGetIt", "#verPop" );
	goLnk.html( goLnk.html().replace( "__VERSION__", ver ) );
	$( "#verPop" ).fadeIn( "fast" );
	makeWindowFit( $( "#front" ) );

	goLnk.click( function( u, e ) { genericUrlOpen( u ); return false; }.curry( url ) );
};
/* }}} */

/*
silly testing function on the back of the widget
*/
var getMethodInfo = function (e) {
	var args = {method: "rtm.reflection.getMethodInfo", method_name: $("#methodName").attr("value"), api_key: gRTMAPIKey};
	rtmSign(args);

	$("#methodDisp").html(rtmAjax(gRTMMethUrl, args));

	makeWindowFit($("#back"));
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
var rtmCall = function (methName, args, asXML) { 
	var ajaxArgs = (args == null) ? {} : args;
	asXML = (typeof(asXML) != "boolean") ? false : asXML;
	
	var ret = checkAuthSetup();
	if(ret.stat == "failure")
		return ret;

	ajaxArgs.method = methName;

	return {stat: "success", data: rtmAjax(gRTMMethUrl, ajaxArgs, asXML)};
};

/*
an experiment in doing the above call asynchronously
*/

var rtmCallAsync = function (methName, args, asXML, callback) {
	var ajaxArgs = (args == null) ? {} : args;
	asXML = (typeof(asXML) != "boolean") ? false : asXML;
	
	var ret = checkAuthSetup();
	if(ret.stat == "failure")
		return ret;

	ajaxArgs.method = methName;

	/*
	imitating our own little partial here....
	*/
	rtmAjax(gRTMMethUrl, ajaxArgs, asXML, function (r, t) { rtmCallSyncEnd.call(null, r, t, callback); });
};

var rtmCallSyncEnd = function (ret, txt, continueFunc) {
	log("got back form async ajax with status " + txt);
	$(ret).children("*").each(function(i) {
					log();
				});
	log("content: " + $(ret).length);

	continueFunc({stat: "success", data: ret});
};

/*
a shared code path for both rtmCall && rtmCallAsync
*/
var checkAuthSetup = function () {
	/*
	first check token status

	make sure we don't call getToken before we're authorized, or RTM will invalidate
	the frob (and it's a pain to reset)
	*/
	if( !checkHaveLocalFrob() ) {
		/*
		 * no frob, we haven't even embarked along authentication yet
		 */
		setupNewAuth();
			
		return {stat: "failure", data: "need token"};
	}

	if( checkValidating() ) {
		/*
		 * in the middle of the validation process, get the token
		 */
		if( rtmAuth() == false ) {
			debugLog( "token acquire failed during authentication!" );
			return {stat: "failure", data: "token acquire failed"};
		}

		/* otherwise,,,, yay! */
		setValidating( false );
	}

	/*
	 * at this point, we definitely have the token. gotta check that whatever we have
	 * is valid (may be old)
	 */
	var tokGood = eval("(" + rtmAjax(gRTMMethUrl, {method: "rtm.auth.checkToken"}) + ")");
	if(tokGood.rsp.stat == "fail" && tokGood.rsp.err.code == "98") {
		log("token bogus, need to regen");
		if(!regenToken()) {
			debugLog( "token regen failed" );
			return {stat: "failure", data: "couldn't regen token for some reason"};
		}
	}
	else if(tokGood.rsp.stat == "fail") {
		debugLog( "token check failed! RTM returned error\n<br/> " + 
			String( tokGood.rsp.err.code ) + ": " + 
			String( tokGood.rsp.err.msg ) );
		return {stat: "failure", data: tokGood.rsp.err.code + ": " + tokGood.rsp.err.msg};
	}
	
	/*
	if we successfully navigated the token auth retrieval labyrinth...
	*/

	$("#needToAuth").hide(); // just in case

	return {stat: "success"};
};

/*
try getting a new auth_token if we need it
*/
var regenToken = function () {
	log("getting fresh token");

	gRTMAuthToken = "";
	
	widget.setPreferenceForKey(null, "frob");
	widget.setPreferenceForKey(null, "authtoken");
	
	var regenArgs = {method: "rtm.auth.getToken", frob: rtmGetFrob()};
	var res = rtmAjax(gRTMMethUrl, regenArgs);

	log("regen token result: " + res);
	res = eval("(" + res + ")");
	if(res.rsp.stat == "fail") {
		log("regen failed: error " + res.rsp.err.code + ", " + res.rsp.err.msg);
		return false;
	}

	gRTMAuthToken = ret.auth.token;
	widget.setPreferenceForKey(ret.auth.token, "authtoken");

	return true;
};

/*
a singleton method for the frob item
*/
var rtmGetFrob = function () {
	if(checkHaveLocalFrob()) {
		log ("returning frob: " + String(widget.preferenceForKey("frob")));
		return widget.preferenceForKey("frob");
	}

	/*
	need a new frob
	*/
	var frobArgs = {method: "rtm.auth.getFrob", api_key: gRTMAPIKey, format: "json"};
	var frobRet = eval("(" + rtmAjax(gRTMMethUrl, frobArgs) + ")");
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
var checkHaveLocalFrob = function () {
	if (!window.widget)
		return false;

	return (widget.preferenceForKey("frob") != "undefined" && typeof(widget.preferenceForKey("frob")) != "undefined");
};


/*
attempt to retrieve a valid auth_token and store it in our prefs
*/
var rtmAuth = function () {
	if(!checkHaveLocalFrob())
		return false;
	
	var args = {method:"rtm.auth.getToken", api_key:gRTMAPIKey, frob:rtmGetFrob(), format: "json"};
	var ret = rtmAjax(gRTMMethUrl, args);
	log("getToken response: " + ret);

	ret = eval("(" + ret + ")");

	/*
	just for testing:
	*/
	if(typeof(ret.rsp) != "undefined")
		ret = ret.rsp;

	if(typeof(ret.auth) == "undefined" || typeof(ret.auth.token) == "undefined") {
		if(typeof(ret.err.code) != "undefined" &&
				Number(ret.err.code) == 101)
			setupNewAuth();
		return false;
	}

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
clear everything out, setup the link
*/
var setupNewAuth = function() {
	clearAuthTokens();

	$("#splashSection").hide();  // just in case
	$("#taskList").empty();
	$("#needToAuth").show();
	$("#needToAuth a:first").click(openAuthUrl);

	if( window.widget )
		setValidating( true );
};

/*
 * validation state accessor/mutator
 */
var checkValidating = function() {
	if( !window.widget ) return false;
	return widget.preferenceForKey( "validating" );
};
var setValidating = function( state ) {
	if( window.widget )
		widget.setPreferenceForKey( state, "validating" );
};

/*
the interface that actually takes care of doing the AJAX call
*/
var rtmAjax = function (url, data, asXML, callback) {
	if(typeof(data) != "object") return "Need a data object";
	if(typeof(data.method) == "undefined") return "Need a method name";

	show_waiting(true);

	data.api_key = gRTMAPIKey;
	data.format = (asXML == true) ? "rest" : "json";
	var dataType = (asXML == true) ? "xml" : "json";
	if(gRTMAuthToken != null && gRTMAuthToken.length > 0) data.auth_token = gRTMAuthToken;
	var widget_ver = rtmSign(data);
	
	if(!window.widget) {
		try {
			netscape.security.PrivilegeManager.enablePrivilege("UniversalBrowserRead");
		} catch (e) {
			log("Permission UniversalBrowserRead denied.");
		}
	}
	if(typeof(callback) == "function") {
		log("sending asynchronously");
		$.ajax ({
			async: true,
			url: url,
			data: data,
			dataType: dataType,
			complete: function () { log("async call completed"); },
			success: callback,
			error: function (req, stat, exc) {
				log("<span class='error'>ERROR: " + String(req) + "<br/>" + stat + "</span>");
			}
		});
	} else {
		log("sending synchronously");
		var retVal = $.ajax({
			url: url,
			data: data,
			dateType: dataType,
			error: function (req, stat, exc) {
				log("<span class='error'>ERROR: " + String(req) + "<br/>" + stat + "</span>");
			}
		});

		show_waiting(false);
		log("rtmAjax return value:\n" + ((asXML == true) ? retVal.responseXML : retVal.responseText));
		return (asXML == true) ? retVal.responseXML : retVal.responseText;
	}
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
this is for showing and setting up the Add/Edit Task panel
*/
var setupTaskPane = function (e) {
	log("setupTaskPane triggered by " + $(e.target).attr("class"));

	var newTask = ($(e.target).hasClass("taskAdd")) ? true : false;
	var name = "";
	var date = "";
	var tags = "";
	var dims = _absPos( e.target );

	if(!newTask) {
		// populate name, date, tags, extraInfo
		var par_li = $(e.target).parents("li:first");
		name = par_li.children(".title").children("a").html().replace("&amp;", "&", "g").replace("&lt;", "<", "g").replace("&gt;", ">", "g");
		date = par_li.children(".due").html();
		tags = par_li.children(".tags").html();

		$(".extraInfo", "#taskPane").val(par_li.children(".task_chk").attr("id").replace("taskchk_", ""));

		log("extraInfo: " + $(".extraInfo", "#taskPane").val());
	}
	/* 
	this gets both the visibile and the hidden 'orig' values at once 
	*/
	$(".taskName > input", "#taskPane").val(name);
	$(".taskDueDate > input", "#taskPane").val(date);
	$(".taskTags > input", "#taskPane").val(tags);

	$(".taskList > span", "#taskPane").empty();

	var new_lists = makeListsList();
	$(".taskList > span", "#taskPane").append(new_lists);


	/*
	objective-specific setup
	*/
	$("#taskSubmit", "#taskPane").unbind("click");

	$( "#taskPane" ).css( { 'top' : dims.y } );
	overlayHideAndSet( "#taskPane" );

	if(newTask) {
		$(".taskTags", "#taskPane").hide();
		$(".taskList", "#taskPane").show();
		$("#taskPane").removeClass("taskEdit").addClass("taskAdd");
		$(".taskList > label", "#taskPane").html("Add to:");
		$("#taskSubmit", "#taskPane").click(addNewTask).val("Add task");
		$("#taskSubmit", "#taskPane").attr("disabled", true);
		$("#taskDelete", "#taskPane").hide();
		$("#taskPane").slideDown(200, function() { makeWindowFit($("#front")); $(".taskName > input.user", "#taskPane").focus(); } );
	} else {
		$(".taskTags", "#taskPane").show();
		$(".taskList", "#taskPane").hide();
		$("#taskPane").removeClass("taskAdd").addClass("taskEdit");
		$(".taskList > label", "#taskPane").html("List:");
		$("#taskSubmit", "#taskPane").click(updateTask).val("Update task");
		$("#taskSubmit", "#taskPane").attr("disabled", false);
		$("#taskDelete", "#taskPane").show();
		$("#taskDelete", "#taskPane").click( deleteTaskConfirm );
		
		$("#taskPane").show(200, function () { makeWindowFit($("#front")); $(".taskName > input.user", "#taskPane").focus(); } );
	}

	return false;
};

var editTaskTagsChange = function (e) {
	log("editTaskTags now " + $(e.target).val());
};

var makeListsList = function() {
	var listsList = $("#lists").clone().get(0);
	
	/*
	TESTING: filter out lists that aren't real (i.e., "All")
	*/
	log(listsList.options.length + " items to check");
	for(var l = 0; l < listsList.options.length; l++) {
		log("l == " + l);
		if(typeof(listsList.options[l]) != "object") {
			log("strange; type is " + typeof(listsList.options[l]) + " with a value of " + listsList.options[l]);
			continue;
		}
		log("checking list item: " + listsList.options[l].id);
		if(Number(listsList.options[l].id.split("_")[1]) < 1) {
			var rem_opt = listsList.removeChild(listsList.options[l]);
			log("removed item: " + rem_opt.id);
		} else if(Number(listsList.options[l].id.split("_")[1]) == gCurrentList) {
			listsList.selectedIndex = l;
		}
	}
	log("resulting listsList size: " + listsList.options.length);
	if(listsList.options.length < 1)
		listsList.disabled = true;

	return listsList;
};

var hideTaskPane = function (e) {
	if($("#taskPane").hasClass("taskAdd")) {
		$("#taskPane").slideUp(100, makeWindowFit.call(null, $("#front")));
	} else {
		$("#taskPane").hide(100, makeWindowFit.call(null, $("#front")));
	}

	return false;
};

var updateTaskPane = function (e) {
	if($(e.target).val().length > 0)
		$("#taskSubmit", "#taskPane").attr("disabled", false);
	else
		$("#taskSubmit", "#taskPane").attr("disabled", true);
		
	return false;
};

var addNewTask = function (e) {
	log("new task name: " + $(".taskName > .user", "#taskPane").val());

	var args = {name: $(".taskName > .user", "#taskPane").val(), timeline: rtmTimeline()};
	if($(".taskDueDate > .user", "#taskPane").val().length > 0) {
		args.name = args.name + " " + $(".taskDueDate > .user", "#taskPane").val();
		args.parse = "1";
	}
	var sel_list_id = $(".taskList > span > select", "#taskPane").get(0).options[$(".taskList > span > select", "#taskPane").get(0).selectedIndex].id.split("_")[1];
	if(Number(sel_list_id) > 0) {
		args.list_id = String(sel_list_id);
	}
	
	/*rtmCall("rtm.tasks.add", args);
	hideTaskPane();
	populateTasks();*/
	$("#taskSubmit", "#taskPane").attr("disabled", true);
	rtmCallAsync("rtm.tasks.add", args, false, function(r, t) { log("task add returned with status " + t); hideTaskPane(); populateTasks(); } );
};

var deleteTaskConfirm = function( e ) {
	_popDeleteConfirm();

	return false;
};

var _popDeleteConfirm = function() { 
	var cnfrmDlog = $( "#confirmDlog" );
	var dims = _absPos( $( "#taskPane" ).get(0) );
	
	cnfrmDlog.css( { "top" : dims.y, "left" : dims.x } );

	$( ".noDont", cnfrmDlog ).click( function( e ) { $( "#confirmDlog" ).hide(); } );
	$( ".yesPlz", cnfrmDlog ).click( function( e ) { $( "#confirmDlog" ).hide(); $( "#taskPane" ).hide(); deleteTask( e ); } );

	cnfrmDlog.show();
};
var deleteTask = function( e ) {
	var extraInfo = $(".extraInfo", "#taskPane").val().split("_");
	var attr = {
		timeline: rtmTimeline(),
		list_id: extraInfo[0],
		taskseries_id: extraInfo[1],
		task_id: extraInfo[2],
		name: $(".taskName > input.user", "#taskPane").val()
		};
	rtmCallAsync("rtm.tasks.delete", attr, false, deleteTaskContinue);
};
var deleteTaskContinue = function(res) {
	if (res.data.rsp.transaction.undoable == "1") {
		prepUndo(res.data.rsp.transaction.id);
	}
	hideTaskPane();
	populateTasks();
};
var updateTask = function (e) {
	var extraInfo = $(".extraInfo", "#taskPane").val().split("_");
	var attr;
	log("task info: " + extraInfo.join(", "));

	/*
	attr needs to be defined new each time; leftover attributes get passed in the URL as 'attr=null'
	SOLUTION: clean up the object with the 'delete' command, e.g.  'delete attr.name;'

	doing it with a semaphore; we really *should* set up the total count before hand, instead of 
	relying on the fact that the Async call will take longer than the test for the next condition 
	to make sure we don't continue prematurely....
	*/
	gInProgress = 0;
	if($(".taskName > input.user", "#taskPane").val() != $(".taskName > input.orig", "#taskPane").val()) {
		gInProgress += 1;
		$("#taskSubmit", "#taskPane").attr("disabled", true);
		attr = {
			timeline: rtmTimeline(),
			list_id: extraInfo[0],
			taskseries_id: extraInfo[1],
			task_id: extraInfo[2],
			name: $(".taskName > input.user", "#taskPane").val()
			};
		log("updating task name to " + attr.name);
		rtmCallAsync("rtm.tasks.setName", attr, false, updateTaskContinue);
	}
	if($(".taskDueDate > input.user", "#taskPane").val() != $(".taskDueDate > input.orig", "#taskPane").val()) {
		gInProgress += 1;
		$("#taskSubmit", "#taskPane").attr("disabled", true);
		attr = {
			timeline: rtmTimeline(),
			list_id: extraInfo[0],
			taskseries_id: extraInfo[1],
			task_id: extraInfo[2]
			};
		if($(".taskDueDate > input.user", "#taskPane").val().length > 0) {
			log ("new due date: " + $(".taskDueDate > input.user", "#taskPane").val());
			attr.due = $(".taskDueDate > input.user", "#taskPane").val();
			attr.parse = "1";
		} else { log("no due date..."); }
		log("updating due date to " + attr.due);
		rtmCallAsync("rtm.tasks.setDueDate", attr, false, updateTaskContinue);
	}
	if($(".taskTags > input.user", "#taskPane").val() != $(".taskTags > input.orig", "#taskPane").val()) {
		gInProgress += 1;
		$("#taskSubmit", "#taskPane").attr("disabled", true);
		attr = {
			timeline: rtmTimeline(),
			list_id: extraInfo[0],
			taskseries_id: extraInfo[1],
			task_id: extraInfo[2],
			tags: $(".taskTags > input.user", "#taskPane").val()
			};
		log("updating tags to " + attr.tags);
		rtmCallAsync("rtm.tasks.setTags", attr, false, updateTaskContinue);
	}

	log("finished sending off updates");
};

var showDlog = function( dlog, e ) {
	var el = this;
	var dims = _absPos( el );
	
	$( dlog ).css( { "top" : dims.y, "left" : dims.x } );
	$( dlog ).slideDown(50, makeWindowFit.curry( $( "#front" ) ) );

	return false;
};

var _absPos = function( el ) {
	var dims = { y : $( el ).offset().top, x : $( el ).offset().left };

	while( el != "undefined" && el != document.body && el != document ) {
		dims.y = dims.y - Number( /[0-9]+/.exec( $( el ).css( "padding-top" ) ) );
		dims.y = dims.y - Number( /[0-9]+/.exec( $( el ).css( "margin-top" ) ) );
		dims.x = dims.x - Number( /[0-9]+/.exec( $( el ).css( "padding-left" ) ) );
		dims.x = dims.x - Number( /[0-9]+/.exec( $( el ).css( "margin-left" ) ) );
		el = el.parentNode;
	}

	return dims;
};

var delegateFilter = function() {
	var el = this;
	var action = null;
	var clsNms = el.className.split( /[ ]+/ );

	for( var i in clsNms ) {
		if( /filter_.*/.test( clsNms[i] ) )
			action = clsNms[i].split( "filter_" )[1];
	}

	if( action )
		_task_filters[ action ]();
	
	return false;
};

var _task_filters = {
	/*
	 * for all of these, doing the calculations for the end date sby overstepping then 
	 * subtracting by one second, just to make sure that we have everything to the end
	 * of the last day of the range
	 */
	none : function() { 
		showDateRange();
	},
	month : function() { 
		var now = new Date();
		var startDate = new Date( now.getFullYear(), now.getMonth(), 1 );
		var endDate = new Date( now.getFullYear(), now.getMonth() + 1, 1 );
		endDate.setMilliseconds( endDate.getMilliseconds() - 1 );
		showDateRange( startDate, endDate );
	},
	week : function() { 
		var now = new Date();

		var startDate = new Date( now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() );
		var endDate = new Date( now.getFullYear(), now.getMonth(), now.getDate() + 8 - now.getDay() );
		endDate.setMilliseconds( endDate.getMilliseconds() - 1 );
		showDateRange( startDate, endDate );
	},
	today : function() { 
		var now = new Date();
		var startDate = new Date( now.getFullYear(), now.getMonth(), now.getDate() );
		var endDate = new Date( now.getFullYear(), now.getMonth(), now.getDate() + 1 );
		endDate.setMilliseconds( endDate.getMilliseconds() - 1 );
		showDateRange( startDate, endDate );
	},
	no_date : function () {
		showTasksNoDate();
	}
};

var showTasksNoDate = function() {
	$( "li", "#taskList" ).filter( function( i ) { return rtmNormalizeDateStr( $( this ).attr( "dueval" ) ) != "undefined"; } ).hide();
	$( "li", "#taskList" ).filter( function( i ) { return rtmNormalizeDateStr( $( this ).attr( "dueval" ) ) == "undefined"; } ).show();
	makeWindowFit( $( "#front" ) );
};
var showDateRange = function( from, to ) {
	$( "li", "#taskList" ).show();
	if( arguments.length < 1 ) {
		makeWindowFit( $( "#front" ) );
		return;
	}

	$( "li", "#taskList" ).filter( _notWithinDateRange.curry( from, to ) ).hide();

	makeWindowFit( $( "#front" ) );
};

var _notWithinDateRange = function( t_0, t_n, i ) { 
	var taskDate = rtmNormalizeDateStr( $( this ).attr( "dueval" ) );
	if( taskDate == "undefined" ) return true;

	return Date.parse( taskDate ) < Date.parse( t_0 ) || Date.parse( taskDate ) > Date.parse( t_n ); 
};

/*
only continue if all three are done
*/
var updateTaskContinue = function () {
	gInProgress -= 1;
	
	if(gInProgress < 1) {
		log("all three updates are complete!");

		hideTaskPane();
		populateTasks();
	} else {
		log(String(gInProgress) + " more to go...");
	}
};

var prepUndo = function(id) {
	$("#undoPane").show();

	var timer_id  = window.setTimeout(trimUndoStack, 30000);	
	gUndoStack.push(new Array(timer_id, id));
	log("new undo added to stack");
};

var doUndo = function(e) {
	if(gUndoStack.length < 1) return false;

	var lastUndo = gUndoStack.pop();
	window.clearTimeout(lastUndo[0]);

	log("one undo cleared");

	var args = {
		transaction_id: String(lastUndo[1]),
		timeline: rtmTimeline()
	};
		
	var res = rtmCall("rtm.transactions.undo", args);
	if(gUndoStack.length < 1) $("#undoPane").hide();

	populateTasks();

	return false;
};

var trimUndoStack = function () {
	if(gUndoStack.length < 1) return;

	gUndoStack.shift();
	log("undo trimmed");
	if(gUndoStack.length < 1) $("#undoPane").hide();
};


/*
method arguments signing function
*/
var rtmSign = function (args) {
	var elArr = [];
	var normStr = "";
	// add port 786 (port RTM)
	var url = "http://" + gRTMSignHost + "/" + gRTMSignPath;

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
	if(!window.widget){
		try {
			netscape.security.PrivilegeManager.enablePrivilege("UniversalBrowserRead");
		} catch (e) {
			log("Permission UniversalBrowserRead denied.");
		}
	}
	var res = $.ajax({
		url: url,
		data: {args: normStr, ver: gAppVersion},
		error: function (req, stat, exc) {
			log("<span class='error'>ERROR: " + String(req) + "<br/>" + stat + "</span>");
		}
	}).responseText;
	log("ajax response: " + res);
	res = eval("(" + res + ")");
	/*
	end ajax code 
	*/
	gServerVer = res.widget.version;
	gServerUrl = res.widget.url;

	log("api_sig: " + res.md5.hash);

	args.api_sig = res.md5.hash;

	return res.widget.version;
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

var statMsg = function( key ) {
	_status( gStatMsgs[ gLang ][ key ] );
};
var hideStat = function() {
	if( gStatusWinTimer != null )
		window.clearTimeout( gStatusWinTimer );
	gStatusWinTimer = window.setTimeout( _statusHide, 1000 );
}

var _status = function( msg, dofade ) {
	if( gStatusWinTimer != null )
		window.clearTimeout( gStatusWinTimer );
	$( ".content", "#statusLine" ).html( msg );
};
var _statusHide = function() {
	$( "#statusLine" ).fadeOut( 500 );
	gStatusWinTimer = null;
};

/*var debugLog = function( msg ) {
	// ooo, boy...
	$( "#statusLine" ).show();
	_status( msg );
};*/
var debugLog = function( m ) { };

var rtmNormalizeDateStr = function (datestr) {
	if( typeof( datestr ) == "undefined" || datestr == "undefined" )
		return "undefined";
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
			new_date.getDate() == now_date.getDate()
			) {
		date_str = "Today";
	} else if((new_date.getYear() == now_date.getYear() &&
				new_date.getMonth() == now_date.getMonth() &&
				new_date.getDate() == now_date.getDate() + 1) ||
			(new_date.getYear() == now_date.getYear() &&
				new_date.getMonth() == now_date.getMonth() + 1 &&
				new_date.getDate() == 1 &&
				now_date.getDate() == new Date( null, null, -1 ))) {
		date_str = "Tomorrow";
	} else if ((new_date.getTime() > now_date.getTime()) &&
			new_date.getTime() < (now_date.getTime() + (6 * 1000 * 3600 * 24 - 1))) {
		date_str = gDays[new_date.getDay()];
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

/*
comparison function for sorting {due:due, task:cur_task}
*/
var rtmTaskSort = function(task1, task2) {
	/*
	 * first, priorities
	 */
	if( task1.task.prio != task2.task.prio ) {
		return ( task1.task.prio > task2.task.prio ) ? 1 : -1;
	}
	
	/* 
	 * if priorities are equiv, then dates are next
	 */
	if(typeof(task1.due) == "undefined" ) {
		if(typeof(task2.due) == "undefined") {
			/* 
			sort lexicographically
			*/
			return ((task1.task.name[0].toLowerCase() == task2.task.name[0].toLowerCase()) ? 0 :
					((task1.task.name[0].toLowerCase() < task2.task.name[0].toLowerCase()) ? -1 : 1))
		} else {
			/*
			undefined's come last
			*/
			return 1;
		}
	} else {
		if(typeof(task2.due) == "undefined") {
			return -1;
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

var openAuthUrl = function (e) {
	var authUrl = gRTMAuthUrl + "?";
	var frobStr = rtmGetFrob();
	var args = {api_key: gRTMAPIKey, perms: "delete", frob: frobStr};

	log("opening auth url");

	rtmSign(args); 
	for(var a in args) {
		authUrl += a + "=" + args[a] + "&";
	}
	//authUrl += "?api_key=" + gRTMAPIKey + "&perms=" + args.perms + "&frob=" + args.frob + "&api_sig=" + args.api_sig;

	genericUrlOpen(authUrl);

	return false;
};

var genericUrlOpen = function(url) {
	debugLog("opening url " + url);
	try {
		if(window.widget) {
			widget.openURL(url);
		} else {
			if(window.open(url) == null)
				debugLog("something prevented the window from opening.");
		}
	} catch(e) { debugLog("problem with urlopen:\n" + e); }
};

var show_waiting = function (show) {
	if(show)
		$("#waitIcon > img").show();
	else
		$("#waitIcon > img").hide();
};

/*
manage single-spot overlay paradigm
*/
var overlayHideAndSet = function(new_ol) {
	$( ".dlog" ).each( function( i ) {
			var dlog = $( this );
			log("hiding overlay " + dlog.attr( 'id' ) );
			dlog.hide();
	} );
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

/*
 * dialog builder!
 */

var _buildDlog = function ( lnk ) {
	$( this ).wrapInner( "<div class='content'></div>" );
	$( this ).append( "<div class='closeBox close'>x</div>" );

	$( ".close", this ).click( hideDlog );
};

/*
resize the window to fit when necessary
*/
var makeWindowFit = function(el) {
	if(window.widget) {
		var newdims = {w:el.width(), h: el.height()};
		log("pre-adjustment dims: w=" + newdims.w + ", h=" + newdims.h);
		adjustForPadMarg.call(el, newdims);
		log("post-adjustment dims: w=" + newdims.w + ", h=" + newdims.h);

		$( ".sizeToMe" ).each( function() {
			var el = this;
			if($( el ).css("display") != "none") {
				var tp_dims = {w: $( el ).width(), h: $( el ).height()};
				adjustForPadMarg.call($( el ), tp_dims);

				log("taskpane dims: w=" + tp_dims.w + ", h=" + tp_dims.h);

				newdims.h = Math.max( newdims.h, tp_dims.h + $( el ).offset().top );
				newdims.w = Math.max( newdims.w, tp_dims.w + $( el ).offset().left );
			}
		} );

		log("resizing to: w=" + newdims.w + ", h=" + newdims.h);

		window.resizeTo(newdims.w, newdims.h);
		$( "#tasklist" ).height( newdims.h );
	}
};

var adjustForPadMarg = function(dims) {
	log("adjusting pad/marg for " + this.attr("id"));
	var extra = {x: 0, y: 0};
	var dimNames = {
			x:["padding-left", "padding-right", "margin-left", "margin-right", "border-left-width", "border-right-width"],
			y:["padding-top", "padding-bottom", "margin-top", "margin-bottom", "border-top-width", "border-right-width"]
		};
	log("pulling extra dimensions");
	for(var i in dimNames.x) extra.x += Number(String(this.css(dimNames.x[i])).replace(/[^0-9]/g, ""));
	for(var i in dimNames.y) extra.y += Number(String(this.css(dimNames.y[i])).replace(/[^0-9]/g, ""));
	log("extra dims: x=" + extra.x + ", y=" + extra.y);
	dims.w += extra.x;
	dims.h += extra.y;
};

var hideDlog = function () {
	$( this ).parents( ".dlog:first" ).slideUp( 100 );
	return false;
};

/*******
main setup function
********/
var setup = function () {

	if( typeof( gDEBUG ) != "boolean" && gDEBUG == true ) {
		log = oldlog;
		$("#evenMore").show();
		$("#debugChk").attr("value", "on");
		$( ".debug" ).show();
	}
	//log = _status;
	
	$( "#statusLine" ).show();

	log("entering setup");

	//Functional.install();

	$.ajaxSetup({
		async:false,
		type:"GET",
		beforeSend: function (req) { req.setRequestHeader("Cache-Control", "no-cache");  }
	});

	if (window.widget) {
		widget.setCloseBoxOffset(0, 0);

		widget.onshow = buildFront;
		widget.onhide = function () { hideTaskPane(); };
			
		if(widget.preferenceForKey("authtoken") != "undefined" &&
				typeof(widget.preferenceForKey("authtoken")) != "undefined") {
			gRTMAuthToken = widget.preferenceForKey("authtoken");
			log("retrieved authtoken: " + gRTMAuthToken);
		}
		widget.setPreferenceForKey(-1, "versionCheckCounter");

		/*
		apple-gooey setup here
		*/
		gInfoBtn = new AppleInfoButton($("#infoButton").get(0), $("#front").get(0), "black", "black", showPrefs);
		gDoneBtn = new AppleGlassButton($("#doneBtn").get(0), "Done", hidePrefs);

		// correct apple's draconian positioning
		var info_img = $("#infoButton").children("img:first");
		$("#infoButton").css({position: "relative", width: info_img.attr("width"), height:info_img.attr("height")}); 


	}
	
	/*********
	connect all of the events
	**********/
	
	/*
	url page opens
	*/
	$(".goToRTM").click(function(e) { genericUrlOpen("http://www.rememberthemilk.com/"); return false; } );
	$(".goToProject").click( function(e) { genericUrlOpen("http://code.google.com/p/rememberthemoof/"); return false; } );
	$(".goToHome").click( function(e) { genericUrlOpen("http://www.hoprocker.net/rtm/"); return false; } );
	$(".goToMoof").click( function(e) { genericUrlOpen("http://www.storybytes.com/moof.html"); return false; } );
	
	$("#lists").change(loadNewList);
	$("#undoBtn").click(doUndo);

	/*
	taskPane setup -- we've generalized this!
	*/
	$(".taskAdd, .taskEdit").click(setupTaskPane);
	$(".taskName > input", "#taskPane").keyup(updateTaskPane);
	$("#taskCancel", "#taskPane").click(hideTaskPane);

	/*
	 * filter setup
	 */
	$( "a.filter", "#filterPane" ).click( delegateFilter );


	/*
	 * dialog setup
	 */
	$( ".dlog" ).each( _buildDlog );
	$( ".showFilterPane" ).click( showDlog.curry( $( "#filterPane" ).get(0) ) );
	$( ".show_tags" ).click( showDlog.curry( $( "#tagList" ).get(0) ) );

	/*
	fancy link coloring
	*/
	/*
	debug stuff
	*/
	$("#clearAuthBtn").click(clearAuthTokens);
	$("#methodInfoBtn").click(getMethodInfo); 
	$("#getnewfrob").click(getFrobTest);
	$("#dumphtml").click(dumpHtml);

	$("#debugChk").click(toggleDebugDisplay);


	if(!window.widget) {
		/*
		this stuff is all for debugging in a browser
		*/
		debugLog( "building test data" );
		$(".hideOnLoad").show();
		buildFront();
		$("body").css("background-color", "#000044'");
		$("#undoPane").show();
		$("#tagList").show();

		$( "#taskSection > *" ).show();

		_setupDebug();
		debugLog( "done building test data" );
	}
	
	log("setup done");
};
$(setup);


/*
testing functions, ignore
*/
var getFrobTest = function (e) {
	var frobArgs = {method: "rtm.auth.getFrob", api_key: gRTMAPIKey, format: "json"};
	
	$("#methodDisp").html(String(rtmAjax(gRTMMethUrl, frobArgs)).replace("<", "&lt;","g").replace(">", "&gt;","g"));
};

var dumpHtml = function (e) {
	if(window.widget) {
		log("dumping widget html");
		try {
			var status = widget.system("echo '" + document.body.innerHTML.replace("'", "\'", "g") + "' > /tmp/RTM.out", null).status;

			if(Number(status) != 0) {
				log("dumpHtml exited with status " + String(status));
			} else {
				log("document html outputted to /tmp/RTM.out");
			}
		} catch (e) {
			log("using widget.system froze things up: " + e);
		}
	}
};


/*
 *
 * DEBUG {{{
 *
 */

var dbg_addDummyTasks = function () {
	$( "#taskList" ).show();
	var task1 = { 	due: "Today",
			task: {
				list_id : 0,
				name    : 'YES!!!!',
				ts_id   : 0,
				task_id : 0,
				tags    : '',
				prio    : '',
				due     : 'Monday'
			} };
	addTaskToList.apply( task1, [] );

	return false;
};

var dbg_addDummyTags = function () {
	addTagListItem.call(String("test1"));
	addTagListItem.call(String("test2"));

	return false;
};

var dbg_toggleSplashShow = function () {
	( $( "#dbg_showSplash" ).attr( "checked" ) == true )
			? $( "#splashSection" ).show()
			: $( "#splashSection" ).hide();
		
};

var dbg_toggleClickHereShow = function () {
	( $( "#dbg_showAuthPane" ).attr( "checked" ) == true )
			? $( "#needToAuth" ).show()
			: $( "#needToAuth" ).hide();
};

var dbg_toggleStatusShow = function () {
	( $( "#dbg_showStatus" ).attr( "checked" ) == true )
			? $( "#statusLine" ).show()
			: $( "#statusLine" ).hide();
};

var dbg_toggleTaskEditShow = function () {
	( $( "#dbg_showTaskEdit" ).attr( "checked" ) == true )
			? $( "#taskPane" ).show()
			: $( "#taskPane" ).hide();
};

var _setupDebug = function () {
	$( "#dbg_addDummyTasks" ).click( dbg_addDummyTasks );
	$( "#dbg_addDummyTags" ).click( dbg_addDummyTags );
	$( "#dbg_showAuthPane" ).click( dbg_toggleClickHereShow );
	$( "#dbg_showSplash" ).click( dbg_toggleSplashShow );
	$( "#dbg_showStatus" ).click( dbg_toggleStatusShow );
	$( "#dbg_showTaskEdit" ).click( dbg_toggleTaskEditShow );

	$( "#devPane" ).show();
};

/* }}} DEBUG */
