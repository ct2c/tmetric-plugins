﻿module Integrations {

    export class IntegrationService {

        static affix = 'devart-timer-link';

        static register(...integrations: WebToolIntegration[]) {

            var convertPatternToRegExp = (matchPattern: string) => new RegExp(matchPattern
                .replace(/[\-\/\\\^\$\+\?\.\(\)\|\[\]\{\}]/g, '\\$&')
                .replace(/\*/g, '.*'));

            integrations.forEach(integration => {

                this._allIntegrations.push(integration);

                // convert all match patterns to array of regexps
                var matchUrl = integration.matchUrl;
                if (matchUrl) {
                    integration.matchUrl = (matchUrl instanceof Array ? <any[]>matchUrl : [<any>matchUrl])
                        .map(pattern => typeof pattern === 'string' ? convertPatternToRegExp(pattern) : pattern);
                }
            });
        }

        static setTimer(timer: Models.Timer) {
            this._timer = timer;
        }

        static needsUpdate() {
            // Find 'Stop' link or 'Start' link associated with current timer.
            // If it is found we should refresh links on a page.
            return $$.all('a.' + this.affix).some(link => {
                var linkTimer = <WebToolIssueTimer>JSON.parse(link.getAttribute('data-' + this.affix));
                return !linkTimer.isStarted || this.isIssueStarted(linkTimer);
            });
        }

        static updateLinks(checkAllIntegrations: boolean) {
            var source = this.getSourceInfo(document.URL);

            if (!this._possibleIntegrations || checkAllIntegrations) {
                this._possibleIntegrations = this._allIntegrations;
            }

            this._possibleIntegrations = this._possibleIntegrations.filter(integration =>
                (!integration.matchUrl || (<RegExp[]>integration.matchUrl).some(pattern => pattern.test(source.fullUrl))) &&
                (!integration.match || integration.match(source)));

            var issues = <WebToolIssue[]>[];

            this._possibleIntegrations.some(integration => {

                var elements = integration.issueElementSelector ? $$.all(integration.issueElementSelector) : [null];

                elements.forEach(element => {

                    var issue = integration.getIssue(element, source);
                    if (issue) {
                        // trim all string values
                        for (var field in issue) {
                            var value = issue[field];
                            if (typeof value === 'string') {
                                issue[field] = value.trim();
                            }
                        }
                        issues.push(issue);
                    }
                    this.updateLink(element, integration, issue);
                });

                if (issues.length) {
                    this._possibleIntegrations = [integration];
                    return true;
                }
            });

            return { issues, observeMutations: this._possibleIntegrations.some(i => i.observeMutations) };
        }

        static updateLink(element: HTMLElement, integration: WebToolIntegration, newIssue: WebToolIssue) {

            var oldLink = $$('a.' + this.affix, element);

            if (!newIssue) {
                this.removeLink(oldLink);
                return;
            }

            var newIssueTimer = <WebToolIssueTimer>{
                isStarted: !this.isIssueStarted(newIssue)
            };
            for (var i in newIssue) {
                newIssueTimer[i] = newIssue[i];
            }

            if (oldLink) {
                var oldIssueTimer = <WebToolIssueTimer>JSON.parse(oldLink.getAttribute('data-' + this.affix));
            }

            if (this.isSameIssue(oldIssueTimer, newIssueTimer) &&
                newIssueTimer.isStarted == oldIssueTimer.isStarted) {
                // Issue is not changed
                return;
            }

            this.removeLink(oldLink);

            // Create new timer link
            var newLink = document.createElement('a');
            newLink.classList.add(this.affix);
            newLink.classList.add(this.affix + (newIssueTimer.isStarted ? '-start' : '-stop'));
            newLink.setAttribute('data-' + this.affix, JSON.stringify(newIssueTimer));
            newLink.href = '#';
            newLink.title = 'Track spent time via Devart Time Tracker service';
            newLink.onclick = function () {
                sendBackgroundMessage({ action: 'putTimer', data: newIssueTimer });
                return false;
            };
            var spanWithIcon = document.createElement('span');
            spanWithIcon.classList.add(this.affix + '-icon');
            newLink.appendChild(spanWithIcon);
            var span = document.createElement('span');
            span.textContent = newIssueTimer.isStarted ? 'Start timer' : 'Stop timer';
            newLink.appendChild(span);

            integration.render(element, newLink);
        }

        static clearPage() {
            $$.all('a.' + this.affix).forEach(a => this.removeLink(a));
        }

        private static _allIntegrations = <WebToolIntegration[]>[];

        private static _possibleIntegrations: WebToolIntegration[];

        private static _timer: Models.Timer;

        private static getSourceInfo(fullUrl: string): Source {

            var host = fullUrl || '';

            var protocol = '';
            var path = '';

            var i = host.search(/[#\?]/);
            if (i >= 0) {
                host = host.substring(0, i);
            }

            i = host.indexOf(':');
            if (i >= 0) {
                i++;
                while (i < host.length && host[i] == '/') {
                    i++;
                }
                protocol = host.substring(0, i);
                host = host.substring(i);
            }

            i = host.indexOf('/');
            if (i >= 0) {
                path = host.substring(i);
                host = host.substring(0, i);
            }

            return { fullUrl, protocol, host, path };
        }

        private static removeLink(link: HTMLElement) {
            if (!link) {
                return;
            }
            var content = link;
            var container = link.parentElement;

            while (container && container.classList
                && container.classList.contains(this.affix + '-' + container.tagName.toLowerCase())) {
                content = container;
                container = container.parentElement;
            }

            if (container) {
                container.removeChild(content);
            }
        }

        private static isSameIssue(oldIssue: Integrations.WebToolIssue, newIssue: Integrations.WebToolIssue) {
            function normalizeServiceUrl(issue: WebToolIssue) {
                var url = (issue.serviceUrl || '').trim();
                if (url.length && url[url.length - 1] == '/') {
                    return url.substring(0, url.length - 1);
                }
                return url;
            }

            function normalizeName(issue: WebToolIssue) {
                return (issue.issueName || '').trim();
            }

            return oldIssue &&
                oldIssue.issueId == newIssue.issueId &&
                normalizeName(oldIssue) == normalizeName(newIssue) &&
                normalizeServiceUrl(oldIssue) == normalizeServiceUrl(newIssue);
        }

        private static isIssueStarted(issue: WebToolIssue): boolean {
            var timer = this._timer;
            if (!timer) {
                return false;
            }

            var task = timer.workTask;
            if (!task && !timer.isStarted) {
                return false;
            }

            var startedIssue = <WebToolIssue>{
                issueId: task.externalIssueId,
                issueName: task.description,
                issueUrl: task.relativeIssueUrl,
                serviceUrl: task.integrationUrl
            };

            return this.isSameIssue(startedIssue, issue);
        }
    }
}